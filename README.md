# 🚇 東京メトロ 3D運行可視化

東京メトロの路線・駅・列車運行状況を3Dビューで可視化するWebアプリケーション（非公式PoC）。

## 📊 システム構成

```
[ODPT / GTFS / GTFS-RT]
        ↓
[Ubuntu サーバー (backend/)]
  - Fastify REST API
  - GTFS-RT デコード
  - JSON 配信
        ↓ Cloudflare Tunnel
[api.<domain>]
        ↓
[Cloudflare Pages (frontend/)]
        ↓
[ブラウザ - Three.js 3D表示]
```

## 🚀 クイックスタート

### バックエンド

```bash
cd backend
npm install
cp ../.env.example .env
# .env を編集して ODPT_API_TOKEN 等を設定
npm run dev
```

API は http://localhost:3000 で起動します。

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開きます。

## 🔧 環境変数

| 変数名 | 内容 | 例 |
|---|---|---|
| NODE_ENV | 実行環境 | development |
| PORT | API ポート | 3000 |
| ODPT_API_TOKEN | ODPT アクセストークン | xxxxxxxx |
| FRONTEND_ORIGIN | CORS 許可オリジン | http://localhost:5173 |
| FETCH_INTERVAL_SECONDS | RT 取得間隔(秒) | 15 |

## 📡 API エンドポイント

| メソッド | パス | 内容 |
|---|---|---|
| GET | /api/health | API 状態確認 |
| GET | /api/routes | 路線一覧 |
| GET | /api/stations | 駅一覧 |
| GET | /api/realtime/trains | 列車リアルタイム |
| GET | /api/realtime/alerts | アラート情報 |
| GET | /api/status | データ取得状態 |

## 🗺️ 開発フェーズ

| フェーズ | 状態 | 内容 |
|---|---|---|
| Phase 1 | ✅ 完了 | 疑似データ 3D 表示 |
| Phase 2 | 🔄 予定 | GTFS 静的データ連携 |
| Phase 3 | 📋 予定 | GTFS-RT リアルタイム連携 |
| Phase 4 | 📋 予定 | Cloudflare 公開 |

## 🔐 セキュリティ

- ODPT API キーはバックエンドのみで保持（フロントエンドに露出しない）
- `.env` は .gitignore 対象
- 管理 API はローカルからのみアクセス可能

## ⚠️ 免責事項

本アプリは、公共交通オープンデータを活用した非公式の可視化 PoC です。
表示される運行情報、列車位置、遅延情報は参考表示であり、正確性・完全性・即時性を保証するものではありません。
実際の運行情報は、東京メトロその他交通事業者の公式情報を確認してください。

## 📖 データ出典

- [公共交通オープンデータ協議会 (ODPT)](https://www.odpt.org/)
- [東京地下鉄株式会社](https://www.tokyometro.jp/)
- GTFS / GTFS-RT 形式のデータを利用

## 📁 ディレクトリ構成

```
├─ frontend/        # Vite + TypeScript + Three.js
├─ backend/         # Node.js + Fastify API
├─ scripts/         # データ取得スクリプト
├─ systemd/         # Ubuntu 常駐設定
├─ docs/            # 設計資料
└─ .env.example     # 環境変数サンプル
```
