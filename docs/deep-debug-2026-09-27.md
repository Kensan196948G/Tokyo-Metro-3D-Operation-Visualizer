# Deep Debug 検証記録 (2026-09-27)

## Goal / Current State

全体を横断して不具合を再現・修正し、品質ゲート、Preview、本番の実証まで確認する。
開始時 main: `7af16f8`、GitHub main: `45ee822`。元ツリーのユーザー変更は保護し、
`auto/deep-debug-quality` を最新 main から別worktreeに作成した。

現行アプリは Fastify + Three.js + JSON cache + systemd + Cloudflare Tunnel。
GitHubにはCIのみが存在し、デプロイworkflowは存在しない。公開HealthはHTTP 200。
Local PostgreSQLは接続可能だが、このアプリにはDB接続、Schema、Migration、Seedがない。
共通配布文書にある別システムのDB実装を、このアプリの実装済み機能と扱わない。
OpenViking / OpenDesign専用MCPはこのセッションでは提供されていない。

## Gap / Priority / Plan

1. P1: API失敗が空配列へ変換され、更新側が接続成功扱いして前回データを失う。
   通信失敗と正常な空配列を区別し、再接続時に回復することを検証する。
2. P1: 取得タイムアウト、キャッシュ書込みエラー伝播、空RT feedと鮮度判定を検証する。
   認証情報はURL・例外を含めログやキャッシュに残さない。
3. P1: npm auditはBackend 1 critical / 8 high、Frontend 1 critical / 3 high。
   互換性を確認し依存更新する。両lintはESLint未導入で失敗するため実行可能にする。
4. P2: CIでlint、build、audit、回帰E2Eを実行する。
5. 外部Gate: ODPT実データ (#26)、アプリ専用DB設計、承認済みデプロイ経路を確認する。

## Affected Files / Test

Frontend API client、更新・状態表示、Unit/E2E、Backend fetch/cache/realtime、対応テスト、
package manifests/locks、lint設定、CI、README、検証記録。
Baseline: Backend 42 tests / Frontend 2 tests PASS。Lintは双方FAIL。
Typecheck、Build、Unit、Integration、Desktop/Mobile/Keyboard/Error/Empty E2E、
依存監査とdiff reviewを修正後に実施する。未実施は成功と扱わない。

## Risk / Rollback

Fastify 4から5および互換プラグインへのmajor更新が必要。Node対応、静的配信、CORS、
admin gateとAPI envelopeを再検証する。DB Migration、権限変更、Secrets変更は行わない。
コードはPR単位でrevert可能。稼働中本番のbuildやsystemdを直接変更せず、
本番反映にはPreview検証、承認済みCI/CDと復旧可能な旧成果物が必要。

## 再現・修正記録

| Round | Evidence / Root Cause | 修正・確認 |
| --- | --- | --- |
| 1 | Unit 42+2成功でも双方lintがESLint未導入で失敗。依存監査Critical/High検出 | ESLint導入、Fastify5/Vite7/Vitest4と互換プラグイン更新。双方audit 0 |
| 2 | API失敗を空配列にして成功表示。回帰Unit 2件FAIL | null/空を区別、旧snapshot保持、初期再試行、重複poll防止 |
| 3 | fetch秘密漏洩、認証URL fragment、cache失敗握潰し、空feed、古いalertsの回帰7件FAIL | URL構造化、安全なエラー、時間/容量制限、atomic file保存、鮮度整合 |
| 4 | ユーザーのroot移動情報とsystemd/実プロセスを照合。Health200、root404、旧WorkingDirectory不存在、プロセスcwdはarchive | unitパス・相対static修正。static欠落起動拒否と実HTML/asset回帰 |
| 5 | Mobileスクリーンショットでtimebar右側欠落。riseがtranslateXを上書き | animation分離、Mobile header整列、駅名拡大上限 |
| 6 | CARTO PNGはHTTP200だが画像内容API KEY REQUIRED | 公開tile URL設定がある場合だけ有効。地図データ未設定を明示 |
| 7 | Reviewerがmalformed dataによるpoll永久停止を指摘 | 配列とtrain座標検証、poll再予約、malformed→回復E2E成功 |

Node22: Backend 60 Unit/Integration、Frontend 6 Unit成功。
E2E 8件成功（Desktop/運転席/通信断/不正JSON型/初期失敗/空/古いデータ/Mobile）。
Canvasは可視性だけでなく色数・フレーム差を検証。Keyboard検索後の結果消去と画素変化を確認。
Mobileバー境界を検証。移動前の空いていない3120番を対象にした初回E2Eは無効な検証として除外し、
この作業で起動した43127番に対して再実施した。

## 外部確認

- GitHub Ruleset `central-auto-merge` はactive、現行3 Required Checksを確認。
  GraphQLでautoMergeAllowed/deleteBranchOnMerge=trueを確認。
- GitHub Runner/Secrets一覧はtoken scope不足でHTTP403。値の取得・変更はしていない。
- OpenViking APIはlocalhost:1933に存在。既存接続設定の認証を値を表示せず使用。
  semantic/keyword検索は各15秒timeoutしたため、ディレクトリ一覧に切替えて関連memoryを取得した。
  `viking://user/opencode/memories/trajectories/cloudflare_tunnel_deployment_insights_20260920151913.md`
  は別プロジェクトのTunnelへ誤接続するリスクを記録していた。本件は既存Tunnelを維持し、DNSを変更しない。
  プロジェクト固有memoryは発見できていない。長期保存は本番実証後に確定知見だけを対象とする。
- OpenDesignのweb/daemonユーザーunitはinactive。専用MCPはなく、比較用design資産は未取得。
- PostgreSQL16.14に既存local roleでSELECT接続成功。このアプリ専用DBやSchemaが特定できず、
  Migration/Seed/業務Read-Write/Backup-Restoreは未実施。別プロジェクトのDBへ変更しない。
- ODPT値は未設定。GitHub Issue #26がOPEN。実データ検証は未達。

## 判断

新規DB/認証システムを推測で追加せず、現行PoCの障害と品質Gateを修復する。
CARTOの認証を回避せず、利用可能なtile契約/配信設定が得られるまで地形マップは無効。
地形グリッド、路線、駅、列車は描画できる。配信URLをVITE変数へ入れる場合、公開可能なものに限る。
CI成果物とmain SHAを照合するrelease手順を追加し、運用復旧を手動再buildから切り離す。
全Goalの完了には、ODPT実データ、DB要件の適用判断、OpenDesign/Memory連携の検証が残る。
