# CI成果物によるリリース運用

対象はユーザーsystemdの `metro3d.service`、ポート3020。従来unitは存在しない `Mirai-DX-Project` 配下を参照しているため、旧unitを復元するだけでは復旧しない。

## 前提とGate

- 作業主体はサービスを所有するユーザー。`gh`、`tar`、`systemctl --user`、`systemd-analyze`、`/usr/bin/node`、`/usr/bin/npm` を使用する。
- 現Production runtimeは `/usr/bin/node v20.20.2`。対応範囲は20.19以降の20系、22.12以降の22系、24以上。準備時にこの実行ファイルで本番依存をインストールし、Fastifyの実ルートへのinjectでhealth、HTML、HTMLから参照されるJS/CSSを検証する。
- Repository rootは `/home/kensan/Projects/Mirai-Admin-Platform/Tokyo-Metro-3D-Operation-Visualizer`。既存 `.env` はその場でsystemdから参照し、スクリプトは内容を読み出さず、コピー・ログ出力しない。
- 指定SHAはGitHub上の現在のmainと一致しなければならない。指定runは `.github/workflows/ci.yml`、mainへのpush、同一SHA、completed/successであることをprepareとactivateの両方で確認する。
- CI artifact名は `metro3d-release`。その中の `release.tar.gz` には `backend/dist`、`backend/package.json`、`backend/package-lock.json`、`frontend/dist`、`RELEASE_SHA` を含める。
- リンク、パストラバーサル、`.env`、想定外ファイル、SHA不一致を拒否する。CIのmain保護・Required Review/Checksの回避は行わない。

## 準備

```sh
node scripts/deploy-release.mjs --prepare <full-sha> <runid>
```

初回は現rootの既存ビルド成果物とpackage/lockのみから `~/.local/share/metro3d/releases/baseline` を保存する。依存の `npm ci --omit=dev --ignore-scripts` と隔離ルート検証に成功しなければ準備を中止する。baselineは既存環境の復旧専用であり、新規CIリリースの正当性を示すものではない。

CI成果物は同じreleases配下のSHAディレクトリに展開する。依存インストールはlifecycle scriptsを無効化し、秘密を含まない準備記録を保存する。既存SHAディレクトリは上書きしない。失敗したstagingは削除し、サービス設定は変更しない。

## 有効化

```sh
node scripts/deploy-release.mjs --activate <full-sha> <runid>
```

有効化はProduction変更であり、主担当が品質GateとPreviewを確認してから実行する。準備済みreleaseとbaselineが必須。管理対象の `~/.config/systemd/user/metro3d.service.d/90-metro3d-release.conf` だけを更新し、変更前内容を `~/.local/share/metro3d/backups` に保存する。管理対象外の同名drop-inは上書きしない。

専用drop-inでWorkingDirectory、EnvironmentFile、ExecStartを置換する。ExecStartは `/usr/bin/env` から `SERVE_STATIC_DIR` をrelease内frontend/dist、`CACHE_DIR` を現rootのbackend/data/cacheに固定し、`/usr/bin/node dist/server.js` を実行する。`.env` 内の古いパスよりこの指定が優先される。

daemon-reload/restart後、localhostのhealth、root HTML、参照JS/CSSをHTTP検証する。失敗時は前回drop-inへ戻して再起動・再検証する。初回、または前回releaseも復旧できない場合はbaselineを指すdrop-inで復旧する。復旧できてもコマンドは失敗終了し、新release成功とは扱わない。

WorkingDirectory等のパス指定とExecStartの引数は同じ引用規則ではない。生成文字列のUnit Testに加え、実systemd parserによる検証を必須とする。2026-09-27の初回反映では引用符付きWorkingDirectory/EnvironmentFileが起動失敗を起こし、自動Rollbackも同じ生成不具合で失敗した。専用drop-inを訂正してbaselineへ復旧したが、この操作は新リリースの配備成功ではない。詳細は `docs/deep-debug-2026-09-27.md` のRound 8を参照。

## 遅延障害の手動Rollback

有効化後に障害が判明した場合は、新規deployを停止し、サービス所有ユーザーで以下を実行する。Repository rootをカレントディレクトリにし、`BACKUP_DIR` は戻したい有効化処理が保存した実際のbackupディレクトリへ置換する。現在の `.env` の内容は表示・コピーしない。

```sh
set -e
BACKUP_DIR="$HOME/.local/share/metro3d/backups/<timestamp>-<sha>"
node --input-type=module - "$BACKUP_DIR" <<'NODE'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceDropin } from './scripts/deploy-release.mjs';
const state = path.join(os.homedir(), '.local/share/metro3d');
if (fs.existsSync(path.join(state, 'operation.lock'))) throw Error('Release operation is active');
const backup = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'previous.json'), 'utf8'));
const baseline = path.join(state, 'releases/baseline');
if (backup.contents === null && !fs.existsSync(path.join(baseline, 'PREPARED.json'))) {
  throw Error('Prepared baseline is missing');
}
const contents = backup.contents ?? serviceDropin(baseline);
if (typeof contents !== 'string' || !contents.startsWith('# Managed by metro3d deploy-release.mjs\n')) {
  throw Error('Unmanaged backup rejected');
}
const target = path.join(os.homedir(), '.config/systemd/user/metro3d.service.d/90-metro3d-release.conf');
fs.writeFileSync(`${target}.tmp`, contents, { mode: 0o600 });
fs.renameSync(`${target}.tmp`, target);
console.log('Previous release or first-deploy baseline drop-in restored.');
NODE
systemctl --user daemon-reload
systemctl --user restart metro3d.service
```

初回backupの `contents` がnullの場合もdrop-inを削除しない。削除すると不存在の旧unitパスが再び有効になるため、上記コードは検証済みbaselineを指すdrop-inを生成する。前回releaseも消失・破損している場合は、baselineの健全性を確認した上で同コードの `const contents` を `const contents = serviceDropin(baseline);` に置換して復旧する。

再起動後、次のHTTP確認が成功するまで復旧完了にしない。

```sh
node --input-type=module <<'NODE'
const base = 'http://127.0.0.1:3020';
async function get(route) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw Error(`HTTP verification failed: ${route}`);
  return response;
}
const health = await (await get('/api/health')).json();
if (health.data?.status !== 'healthy') throw Error('Health is not healthy');
const html = await (await get('/')).text();
const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]);
if (!assets.some(asset => asset.endsWith('.js'))) throw Error('HTML has no JavaScript asset');
for (const asset of assets) await (await get(asset)).arrayBuffer();
console.log(`Rollback verified: health, root, and ${assets.length} assets.`);
NODE
```

その後、Cloudflare経由の公開URL、ブラウザ主要Flow、サービスログとError Rateを確認する。外部確認が失敗する場合は公開経路の障害を切り分け、localhost成功だけで完了扱いしない。

## 検証と制限

```sh
node --test scripts/deploy-release.test.mjs
```

単体テストはGate、入力、archive path、unit生成のみを扱い、GitHub・systemd・本番プロセスを操作しない。準備時のruntime検証は外部ODPT接続を無効化した隔離cacheを使用する。本番ODPT取得、Cloudflare/Access経由の外部URL、ブラウザ主要Flow、ログ・Error Rateは主担当が別途確認する。

リリース中は一時的にサービスが停止する。Database変更は行わず、既存cacheは共有する。初回baseline自体が健全でない場合、またはNodeバージョンが対応範囲外の場合は停止して原因を解消する。操作lockが残った場合は実行中プロセスがないことを確認してから手動復旧する。展開先はサービスユーザーが所有し、改変できるユーザーを信頼する前提。自己更新や古いreleaseの自動削除は行わない。
