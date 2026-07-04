# 🚀 本番デプロイ手順書（Phase 4: Cloudflare 構成）

本書は人間のオペレーターが実行する手順です。**課金・外部公開・秘密情報の操作を含むため、CTO（Claude）は自動実行しません。**

## 📌 本番構成

```
[ブラウザ]
   │ HTTPS
   ▼
[Cloudflare Pages]  ←  frontend/dist（静的配信）
   │ /api/* は VITE_API_BASE_URL の API へ
   ▼
[Cloudflare Tunnel] ← api.<your-domain>
   │ (アウトバウンド接続のみ・ポート開放不要)
   ▼
[Ubuntu サーバー: systemd]
   ├─ metro3d-api.service     (Fastify API, PORT=3000)
   └─ metro3d-fetch.timer     (GTFS-RT 15秒間隔取得)
```

## ✅ 前提条件

| 項目 | 内容 | 状態 |
|---|---|---|
| ODPT アカウント | https://developer.odpt.org/ でトークン発行 | ⬜ 人間が登録 |
| Cloudflare アカウント | Pages / Tunnel 利用（無料枠可） | ⬜ 人間が登録 |
| 独自ドメイン | Cloudflare 管理下の DNS | ⬜ 任意 |
| Ubuntu サーバー | Node.js 20+ / systemd | ✅ 検証済み |

## 1️⃣ バックエンド配置（Ubuntu サーバー）

```bash
sudo useradd -r -m -d /opt/metro3d metro3d 2>/dev/null || true
sudo mkdir -p /opt/metro3d
sudo rsync -a --exclude node_modules --exclude .env backend/ /opt/metro3d/backend/
cd /opt/metro3d/backend && sudo -u metro3d npm ci && sudo -u metro3d npm run build
```

`/opt/metro3d/.env`（root:metro3d 0640 推奨）:

```ini
NODE_ENV=production
PORT=3000
ODPT_API_TOKEN=<発行したトークン>
ODPT_GTFS_URL=<ODPT の GTFS zip URL>
ODPT_GTFS_RT_URL=<ODPT の GTFS-RT URL>
FRONTEND_ORIGIN=https://<pages-domain>
CACHE_DIR=/opt/metro3d/backend/data/cache
LOG_LEVEL=info
```

systemd ユニット登録:

```bash
sudo cp systemd/metro3d-api.service systemd/metro3d-fetch.service systemd/metro3d-fetch.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now metro3d-api.service metro3d-fetch.timer
curl -s http://localhost:3000/api/health   # → status: healthy
sudo -u metro3d bash -c 'cd /opt/metro3d/backend && node dist/scripts/fetch-gtfs.js'  # 初回静的取得
```

## 2️⃣ Cloudflare Tunnel（API 公開）

```bash
# cloudflared インストール後
cloudflared tunnel login
cloudflared tunnel create metro3d
cloudflared tunnel route dns metro3d api.<your-domain>
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: api.<your-domain>
    service: http://localhost:3000
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
curl -s https://api.<your-domain>/api/health
```

## 3️⃣ Cloudflare Pages（フロントエンド公開）

| 設定 | 値 |
|---|---|
| Build command | `npm run build` |
| Build output | `dist` |
| Root directory | `frontend` |
| 環境変数 | `VITE_API_BASE_URL=https://api.<your-domain>` |

GitHub リポジトリ連携で main への push ごとに自動デプロイ。

## 4️⃣ 受入検証（AC-006 実データ検証）

```bash
# サーバー側
curl -s https://api.<your-domain>/api/status | jq   # gtfsRtFetchSuccess: true / stale: false
journalctl -u metro3d-fetch.service -n 20           # 15秒間隔で success
```

- [ ] ブラウザで Pages URL を開き 9 路線が表示される
- [ ] 列車の `positionSource` が `gtfs-rt` または `station-based`（mock でない）
- [ ] 遅延列車が黄色パルス表示される（遅延発生時）
- [ ] `/api/status` の `dataSource: "gtfs"` を確認
- [ ] 15 秒ごとに「最終更新」が進む

## 5️⃣ ロールバック

| 事象 | 対応 |
|---|---|
| API 障害 | `sudo systemctl restart metro3d-api`／直前タグへ `git checkout` → rebuild |
| RT 取得失敗連続 | フロントは自動で stale 表示・mock 継続。ODPT 側status確認 |
| Pages 不具合 | Pages ダッシュボードから直前デプロイへ Rollback |
| Tunnel 断 | `sudo systemctl restart cloudflared` |

## 🔐 セキュリティチェックリスト

- [ ] `.env` の権限 0640 以下・git 追跡外
- [ ] `ODPT_API_TOKEN` がフロントエンド/リポジトリに存在しない（`git grep` で確認）
- [ ] 管理 API (`/api/admin/refetch`) が Tunnel 経由で 403 になる
- [ ] `FRONTEND_ORIGIN` が Pages ドメインのみ
