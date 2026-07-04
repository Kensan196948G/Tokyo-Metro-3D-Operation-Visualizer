# 🚇 東京メトロ 3D運行可視化

東京メトロの路線・駅・列車運行状況を3Dビューで可視化するWebアプリケーション（非公式PoC）。

## 🚆 リアルタイム流動表示の仕組み

```
[ODPT GTFS-RT] --15秒間隔--> [常駐APIプロセス] --キャッシュ--> [ブラウザ]
                                                              毎フレーム lerp 補間
                                                              (60fps で滑らかに移動)
```

- バックエンドが `ODPT_GTFS_RT_URL` 設定時に **常駐ポーリング**（`FETCH_INTERVAL_SECONDS`、既定 15 秒）
- フロントエンドは前回位置→今回位置を **smoothstep 補間**し、元データが 15 秒粒度でも毎フレーム流れるように表示
- 列車は進行方向を向き、遅延編成はパルス発光
- トークン未設定時はモック列車が路線上を決定論的に往復進行（デモも流動）

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
| GET | /api/routes | 路線一覧（9 路線・レイヤー高さ付き） |
| GET | /api/stations | 駅一覧（GTFS キャッシュ優先 / mock フォールバック） |
| GET | /api/route-shapes | 路線形状（GTFS shapes 由来） |
| GET | /api/realtime/trains | 列車リアルタイム（GTFS-RT / mock） |
| GET | /api/realtime/alerts | アラート情報 |
| GET | /api/status | データ取得状態（静的/RT 鮮度・失敗回数） |
| POST | /api/admin/refetch | 手動再取得（ローカルのみ・静的+RT 並行） |

## 🖥️ LAN 常駐サービス（systemd・単一サービス構成）

backend が frontend のビルド成果物も配信する構成で、LAN 内へ常時公開できます。

```bash
# 1. ビルド
cd frontend && npm run build && cd ../backend && npm run build && cd ..

# 2. .env をリポジトリ直下に用意 (PORT / SERVE_STATIC_DIR を設定)
cp .env.example .env  # PORT=3020, SERVE_STATIC_DIR=<絶対パス>/frontend/dist 等

# 3. systemd ユーザーユニット登録（root 不要）
cp systemd/metro3d-lan.service ~/.config/systemd/user/metro3d.service
systemctl --user daemon-reload
systemctl --user enable --now metro3d.service

# 4. ブート時自動起動（ログイン不要で起動）
loginctl enable-linger $USER
```

| 操作 | コマンド |
|---|---|
| 状態確認 | `systemctl --user status metro3d` |
| ログ | `journalctl --user -u metro3d -f` |
| 再起動 | `systemctl --user restart metro3d` |
| 停止/無効化 | `systemctl --user disable --now metro3d` |

## 🔄 データ取得コマンド

```bash
cd backend
npm run fetch:static     # GTFS 静的データ (zip) 取得→正規化→キャッシュ
npm run fetch:realtime   # GTFS-RT (protobuf) 取得→デコード→キャッシュ
```

`.env` の `ODPT_API_TOKEN` / `ODPT_GTFS_URL` / `ODPT_GTFS_RT_URL` が必要。
未設定・未取得時は自動的にモックデータで動作します。

## 🗺️ 開発フェーズ

| フェーズ | 状態 | 内容 |
|---|---|---|
| Phase 1 | ✅ 完了 | 疑似データ 3D 表示（PR #1） |
| Phase 2 | ✅ 完了 | GTFS 静的データ連携（PR #7） |
| Phase 3 | ✅ 完了 | GTFS-RT リアルタイム連携（PR #8） |
| Phase 4 | 📋 予定 | Cloudflare 公開 |
| Phase 5 | 📋 予定 | UI 仕上げ・実データ検証 |

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
