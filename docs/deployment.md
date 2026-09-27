# 本番運用と公開範囲

公開URL: **https://railway.mirai-dx-platform.com/**

本書は現行運用の入口である。反映・復旧の実行手順は
[CI成果物によるリリース運用](release-operations.md)、DB操作は
[Local PostgreSQL設計と運用](postgresql.md)を正本とする。
Production反映、Secret変更、破壊的操作にはHuman Gateが必要。

## 現行構成

```text
Browser -> Cloudflare Edge -> existing Cloudflare Tunnel
        -> http://localhost:3020 -> metro3d.service
                                   |-- Fastify /api/*
                                   |-- frontend/dist
                                   |-- Local PostgreSQL (metro3d)
                                   `-- GTFS / GTFS-RT polling
```

- 単一ホスト・単一サービス構成。Pagesや別APIホストは使用しない。
- フロントエンドは同一オリジンの相対 `/api` を使用する。
- サービスはユーザーsystemdの `metro3d.service`、Tunnelは `metro3d-cloudflared.service`。
- GTFS-RT取得はserver内蔵ポーリング。別のfetch timerを併用しない。
- 本番は `CACHE_BACKEND=postgres`。専用Schema、Migration、最小権限Roleを使用する。
- 新規DB SecretはRepository外の `~/.config/metro3d/metro3d.env`、権限0600。
  値を表示・commit・ログ保存しない。

## 公開範囲

ユーザーの承認済み要件は**すべての閲覧者がログインなしで閲覧可能**である。
`railway.mirai-dx-platform.com` にメール限定のCloudflare Access Applicationを
追加しない。公開閲覧と管理操作の権限は分離する。

- 閲覧用HTML・JS・GET APIは匿名公開。
- `/api/admin/refetch` はローカルCLI限定。Cloudflare経由、外部接続、
  Origin/Sec-Fetch-Siteを伴うブラウザ呼び出しは403。
- 既存のWAFやBot対策を一括無効化しない。他ホストのAccess設定を変更しない。
- 既存Tunnel・DNSを使用する。新規Tunnel作成やDNSの付け替えは不要。

2026-09-27の確認では、対象に一致するAccess Applicationがなく、匿名HTTPは200、
Accessログインへの転送もなかった。IP制限・アカウント共通設定の一部はAPI権限不足で
未確認であり、すべての地域・IPからの到達を保証したものではない。

## リリースと確認

通常PRでRequired Checksを通し、mainの成功CIが生成した成果物を使用する。
作業ツリー内の再ビルドだけでは、稼働中のreleaseは更新されない。
`git checkout`や旧unitへの単純復元を本番Rollbackとして使用しない。

1. [リリース運用](release-operations.md)に従いprepareする。
2. 隔離PreviewでHealth、HTML/JS、API、ブラウザ主要Flowを確認する。
3. DBを伴う場合はMigration、限定RoleのRead/Write、Backup/Restoreを確認する。
4. Human Gateの範囲を確認してactivateする。
5. localhostと公開URLの両方、匿名ブラウザ、ログ・Error Rateを確認する。

以下は読み取り専用の疎通確認であり、これだけで全受入条件を満たすものではない。

```sh
systemctl --user is-active metro3d.service metro3d-cloudflared.service
systemctl --user is-enabled metro3d.service metro3d-cloudflared.service
curl --fail --silent --show-error https://railway.mirai-dx-platform.com/api/health
curl --silent --show-error --output /dev/null --write-out '%{http_code} %{redirect_url}\n' https://railway.mirai-dx-platform.com/
```

本番Healthは `data.status=healthy`、`data.storage=postgres` を確認する。
HTML参照先JS/CSSとCI成果物の一致も確認する。Healthだけの200を配備成功にしない。
サービスenabledは自動起動設定の証拠であり、実機再起動試験の代替ではない。

## ODPT実データ検証: 準備待ち

2026-09-27、ユーザーはTokenとGTFS/GTFS-RT URLが未準備と回答した。
現在はDEMOモック運行。実データの取得成功を主張しない。
[Issue #26](https://github.com/Kensan196948G/Tokyo-Metro-3D-Operation-Visualizer/issues/26)で追跡する。
Issue上の「AC-006」は実データ検証の呼称だが、要件定義書のAC-006はAPI取得失敗時の
エラー表示である。両者を混同せず、実ODPT検証を独立した未達項目として扱う。

準備後は `ODPT_API_TOKEN`、`ODPT_GTFS_URL`、`ODPT_GTFS_RT_URL` を保護された
サーバー側環境ファイルで扱う。Secretをチャット、CLI引数、PR、Memoryに貼らない。
読み込むEnvironmentFileと権限を確認し、Preview成功後に承認範囲内で本番へ反映する。

- メトロ列車の `positionSource`、APIの取得状態・鮮度、実データ表示を確認する。
- JRのmockと実データを区別する。15秒周期の更新・遅延情報を実feedで確認する。
- Token不正、timeout、空feed、古いfeedの状態表示・復旧を検証する。
- Tokenがブラウザ配信物やログへ露出していないことを確認する。

API通信障害時は接続エラーを表示して直前の描画を保持し、復旧を再試行する。
正常な空feedと通信失敗は区別する。DB障害はHealth/APIを503とし、mock成功で隠さない。
モックによるテスト成功を実ODPT検証の成功と読み替えない。

## 障害対応とRollback

- 新規releaseに重大異常があれば反映を止め、[検証付きRollback](release-operations.md)を使用する。
- DB切替後に旧JSON構成へ戻す場合は[DBのRollback](postgresql.md#risk--rollback)に従い、
  更新停止と最新snapshotのexportを考慮する。既存DBやbackupを削除しない。
- Tunnel障害は対象の `metro3d-cloudflared.service` と既存ingressを確認する。
  共用・他プロジェクトのTunnelを停止したりDNSを再作成したりしない。
- 復旧後も公開HTML/JS、API、主要Flow、ログ・Error Rateを再確認する。

2026-09-27の本番切替、DB復元試験、公開E2E、残存リスクの証跡は
[Issue #36](https://github.com/Kensan196948G/Tokyo-Metro-3D-Operation-Visualizer/issues/36#issuecomment-5856503723)を参照。
過去のPages分離構成やメール限定公開の手順はgit履歴で参照できるが、現行運用には適用しない。
