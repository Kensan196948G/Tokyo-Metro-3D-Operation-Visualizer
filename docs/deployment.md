# 🚀 本番デプロイ手順書（Phase 4: Cloudflare 単一 Tunnel 構成）

本書は人間のオペレーターが実行する手順です。**課金・外部公開・秘密情報の操作を含むため、CTO（Claude）は自動実行しません。**

公開 URL: **https://railway.mirai-dx-platform.com**

## 📌 本番構成（単一 Tunnel・単一サービス）

現行の LAN 常駐サービス（backend が frontend/dist も配信、PORT=3020）を
そのまま Cloudflare Tunnel で公開します。Pages・別 API ホストは使いません。

```
[ブラウザ]
   │ HTTPS
   ▼
[Cloudflare Edge]  railway.mirai-dx-platform.com
   │ (Tunnel: アウトバウンド接続のみ・ポート開放不要)
   ▼
[cloudflared] ── http://localhost:3020 ──▶ [metro3d.service]
                                             ├─ Fastify API (/api/*)
                                             ├─ frontend/dist 静的配信 (/)
                                             └─ GTFS-RT 常駐ポーリング内蔵
```

- フロントは `VITE_API_BASE_URL` **未設定**でビルド（相対 `/api` = 同一オリジン）→ CORS 不要
- `metro3d-fetch.timer` は **使用しない**（server 内蔵ポーリングと二重取得になるため）
- 管理 API `/api/admin/refetch` は cf-* ヘッダ検出で 403（コード側でガード済み）

## ✅ 前提条件

| 項目 | 内容 | 状態 |
|---|---|---|
| ODPT アカウント | https://developer.odpt.org/ でトークン発行 | ⬜ 人間が登録 |
| Cloudflare アカウント | mirai-dx-platform.com のゾーンが Cloudflare DNS 管理下 | ⬜ 人間が確認 |
| Ubuntu サーバー | Node.js 20+ / systemd / metro3d.service 稼働中 | ✅ 検証済み (LAN 3020) |

## 1️⃣ サービス側の準備（既存 LAN サービスを流用）

リポジトリ直下 `.env` を本番値へ（該当行のみ）:

```ini
NODE_ENV=production
PORT=3020
ODPT_API_TOKEN=<発行したトークン>
ODPT_GTFS_URL=<ODPT の GTFS zip URL>
ODPT_GTFS_RT_URL=<ODPT の GTFS-RT URL>
FRONTEND_ORIGIN=https://railway.mirai-dx-platform.com
SERVE_STATIC_DIR=/home/kensan/Projects/Tokyo-Metro-3D-Operation-Visualizer/frontend/dist
FETCH_INTERVAL_SECONDS=15
```

```bash
# ビルド反映 + 再起動（トークン設定後は常駐ポーリングが自動で実データ取得開始）
cd frontend && npm run build && cd ../backend && npm run build && cd ..
systemctl --user restart metro3d
curl -s http://localhost:3020/api/health   # → status: healthy
# 旧キャッシュの一掃（垂直再設計後の座標を反映させる）
curl -s -X POST http://localhost:3020/api/admin/refetch | jq .ok
```

## 2️⃣ Cloudflare Tunnel（人間実行）

```bash
# cloudflared インストール: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel login                       # ブラウザで mirai-dx-platform.com ゾーンを許可
cloudflared tunnel create metro3d              # <TUNNEL_ID> が発行される
cloudflared tunnel route dns metro3d railway.mirai-dx-platform.com   # DNS CNAME 自動作成
```

設定ファイル（テンプレ: `deploy/cloudflared-config.yml.example`）:

```bash
mkdir -p ~/.cloudflared
cp deploy/cloudflared-config.yml.example ~/.cloudflared/config.yml
# <TUNNEL_ID> を置換し credentials-file のパスを確認
```

常駐化（どちらか）:

```bash
# A) システムサービス（推奨・要 sudo）
sudo cloudflared --config /home/kensan/.cloudflared/config.yml service install
sudo systemctl enable --now cloudflared

# B) ユーザーサービスで試運転
cloudflared tunnel run metro3d
```

疎通確認:

```bash
curl -s https://railway.mirai-dx-platform.com/api/health | jq .data.status   # "healthy"
```

## 3️⃣ 受入検証（AC-006 実データ検証）

```bash
curl -s https://railway.mirai-dx-platform.com/api/status | jq
#   gtfsRtFetchSuccess: true / stale: false / dataSource: "gtfs"
journalctl --user -u metro3d -n 20    # ポーリングが 15 秒間隔で success
```

- [ ] ブラウザで https://railway.mirai-dx-platform.com — 地下鉄9路線 + JR5路線が表示される
- [ ] メトロ列車の `positionSource` が `gtfs-rt` または `station-based`（JR は仕様上 mock）
- [ ] 下部バーが「LIVE 実データ」表示になる
- [ ] 遅延列車が帯発光＋パルス表示される（遅延発生時）
- [ ] 15 秒ごとに「更新」時刻が進む
- [ ] `curl -s -X POST -H 'cf-connecting-ip: 1.2.3.4' https://railway.mirai-dx-platform.com/api/admin/refetch` が **403**

## 4️⃣ ロールバック

| 事象 | 対応 |
|---|---|
| API 障害 | `systemctl --user restart metro3d`／直前タグへ `git checkout` → rebuild |
| RT 取得失敗連続 | フロントは自動で DEMO(mock) 継続。ODPT 側 status 確認 |
| Tunnel 断 | `sudo systemctl restart cloudflared` |
| 公開停止 | `sudo systemctl stop cloudflared`（LAN 提供は継続） |

## 🔐 セキュリティチェックリスト

- [ ] `.env` の権限 0640 以下・git 追跡外
- [ ] `ODPT_API_TOKEN` がフロントエンド/リポジトリに存在しない（`git grep` で確認）
- [ ] 管理 API が Cloudflare 経由で 403（cf-* ヘッダガード・上記 AC で確認）
- [ ] Cloudflare ダッシュボードで Bot Fight Mode / rate limiting を必要に応じ有効化

## 📎 参考: 旧 Pages + Tunnel 分離構成

以前の設計（frontend=Pages / api.<domain>=Tunnel の 2 ホスト構成）は
`git log docs/deployment.md` の履歴を参照。単一サブドメイン運用が決まったため
本書は単一 Tunnel 構成へ改訂した（2026-07-05, Issue #23）。
