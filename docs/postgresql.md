# Local PostgreSQL 設計と運用

## Goal / Current State / Gap

2026-09-27、ユーザーはLocal PostgreSQLの設計・実装、専用DB/RoleとRepository外Secretの新設、
隔離検証とCI/Preview成功後の本番切替を承認した。既存はJSONファイル保存であり、API契約を維持して
永続化を追加する。DNS、既存DB、認証・公開範囲は変更しない。

## Decision / Priority / Plan

- 既存の正規化済み運行スナップショットをJSONBへ保存する。ORMや業務モデルの再設計は追加しない。
- `metro3d.snapshots`: key主キー、payload JSONB NOT NULL、updated_at timestamptz。
  keyはstations/route-shapes/gtfs-meta/trains/alerts/rt-metaのみ。array/object型をCHECKで制約する。
- 関連データの更新は同一clientのtransaction、読み取りは単一SELECTで整合性を保つ。
  primary key B-treeが点検索を支える。JSON内部検索は行わないためGIN indexは追加しない。
- `metro3d.schema_migrations` はversion、SHA-256 checksum、適用時刻を記録。
  advisory transaction lockで並行適用を直列化し、適用済みSQLの改変を拒否する。
- RuntimeはSELECT/INSERT/UPDATEだけを持つ専用LOGIN Role。OwnerはNOLOGIN。
  PUBLICには専用DBのCONNECTとschema/tableの権限を与えない。RuntimeにDDL/DELETE/Role管理権限はない。
- `CACHE_BACKEND=file` が互換既定値。`postgres` の場合はDATABASE_URLが必須。
  DB障害をmockに変換せずAPI/Healthを503にする。Pool接続数5、接続・query timeoutを設定する。
- Seedは空DBのみにTokyoMetroのデモ駅とsource=mockのmetadataを保存する。
  リアルタイム列車は従来どおり動的mock。既存データを上書きせず、実ODPTデータと偽らない。

## Affected Files / Tests

Backend storage、fetch、routes、health、起動・停止、DB CLI、Unit/実DBIntegration、CI、release script。
FrontendのAPI契約と描画ロジックは変更しない。

Unitに加え、専用DBの実接続でMigration再実行、checksum拒否、Seed再実行、Read/Write、
制約違反時のtransaction rollback、権限拒否、JSON exportを検証する。
CIは隔離PostgreSQL16 serviceをloopbackへ公開し、限定RoleでIntegrationとE2Eを実行する。
CI専用のtrust認証はその使い捨てserviceのみ。本番はSCRAM認証であり、pg_hba.confは変更しない。

## 新規DBの準備

管理者用Unix socket接続が必要。既存名のDB/Role/接続ファイルが存在したら停止する。
途中失敗時も自動DROPせず、専用オブジェクトの状態を調査する。

```sh
cd backend
npx tsx src/db/provision.ts metro3d
```

Runtime Secretは `~/.config/metro3d/metro3d.env` (0600) に保存し、値を表示・commitしない。
DB名はmetro3d、Ownerはmetro3d_owner、Runtimeはmetro3d_app。
以下のDATABASE_URLは管理者が既存認証からプロセス環境へ設定する。CLI argvにSecretを含めない。

```sh
DB_MIGRATION_ROLE=metro3d_owner npm run db:migrate
DB_RUNTIME_ROLE=metro3d_app npx tsx src/db/cli.ts grant
```

既存JSONがあればSeedより先にimportする。importは空のsnapshot tableのみを許可し、全件を
transactionで保存する。元JSONを削除しない。importが0件ならSeedを適用する。

```sh
npm run db:import -- /absolute/path/to/legacy/cache
npm run db:seed
```

## Backup / Restore

```sh
npm run db:backup -- /outside/repository/metro3d.dump
```

custom-format、0600、専用schemaのみを保存する。接続SecretやRole passwordはdumpに含めない。
出力先が存在する場合は上書きしない。pg_dump/pg_restoreはserverと同じmajor版を必須とし、
Debian標準の `/usr/lib/postgresql/<major>/bin` または `PG_BIN_DIR` を使用する。
実検証ではPATH上のpg_dump17がserver16へ復元不能なtransaction_timeout設定を出力する問題を
再現したため、major一致をGateに追加した。

Restoreは別の新規DBへ行う。対象DBのDATABASE_URLを設定し、metro3d schemaが存在しないことを
確認する。`--clean`やDROPは使わず、single transaction / exit-on-errorで復元する。

```sh
npm run db:restore -- /outside/repository/metro3d.dump
DB_RUNTIME_ROLE=metro3d_app npx tsx src/db/cli.ts grant
```

Restoreはowner/ACLを復元しない。対象DBに適したOwnerとRuntime権限を管理者が確認してから利用する。
schema/row件数/payload hash、Migration checksum、限定RoleのRead/Writeを比較し、APIとUIも再検証する。
2026-09-27の隔離実証では5 snapshotsのdump/restoreと全payload hash一致を確認した。

## Risk / Rollback

Migrationは専用DBへの追加のみで、既存DB変更や不可逆DDLはない。
アプリRollback時にschemaを削除しない。旧JSON releaseへ戻す場合はDBの最新snapshotを新規directoryへ
exportし、停止中にCACHE_DIRをそのdirectoryへ向ける。古いJSONをそのまま使うとDB移行後の更新を失う。

```sh
npm run db:export -- /outside/repository/rollback-cache
```

exportは単一SELECTのsnapshotを0600ファイルへ書き、新規directoryをatomic renameで公開する。
切替前に停止/取得poll停止で新規更新を止め、export、systemd設定検証、再起動、Health/公開UIを確認する。
データ保持用DBとbackupは残す。DROP/TRUNCATEや本番データ削除は別承認が必要。

DB停止時の外部監視は `/api/health` の503とAPIのSTORAGE_UNAVAILABLEを利用する。
自動外部通知サービスの新設はしていない。ODPT Token/URLがない間はDEMO表示を維持する。

## 根拠

- [node-postgres Transactions](https://node-postgres.com/features/transactions)
- [PostgreSQL 16 Privileges](https://www.postgresql.org/docs/16/ddl-priv.html)
- [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)
