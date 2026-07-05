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

## 🎛️ 画面 UI / 操作

グラスモーフィズム基調のダーク HUD（`Chakra Petch` / `Shippori Mincho B1` / `Zen Kaku Gothic New` の3書体、シアン/琥珀アクセント、`backdrop-filter` すりガラス、滑らかなトランジション）。

| 領域 | 機能 |
|---|---|
| 🏷️ ヘッダー | `TOKYO METRO 3D` ブランド + 路線数/駅数/更新時刻/API接続の HUD |
| 🎚️ 左パネル | 路線トグル（クリックで表示/非表示）、深さ強調スライダー（×1〜×20）、駅名表示（なし/主要駅/全駅）、地形グリッド・列車・遅延パルスのトグル、運行情報、視点ボタン（全体表示/リセット）、折りたたみ |
| ⏱️ 下部バー | ライブ時刻 + 時間帯フェーズ（早朝〜夜）、一日進捗、データ種別（LIVE 実データ / DEMO モック）、運行本数、一時停止/再開 |
| 🖱️ 3D操作 | ドラッグ回転 / ホイール拡大 / 駅・列車ホバーで情報ポップアップ |

- **深さ強調**は位置(y)のみを誇張し、駅マーカー・列車形状は歪めない
- **駅名ラベル**は Sprite ビルボード。主要駅＝乗換駅（2路線以上）を自動判定
- 外部フォントは CDN 読込・オフライン時はシステムフォントへフォールバック

## 📊 システム構成（単一サービス + 単一 Cloudflare Tunnel）

```
[ODPT / GTFS / GTFS-RT]
        ↓ 常駐ポーリング (15s)
[Ubuntu サーバー metro3d.service (backend/)]
  - Fastify REST API (/api/*)
  - frontend/dist 静的配信 (/)
  - GTFS-RT デコード
        ├── LAN: http://192.168.0.185:3020
        └── cloudflared Tunnel
              ↓
[https://railway.mirai-dx-platform.com]
        ↓
[ブラウザ - Three.js 3D表示]
```

公開手順の正本: `docs/deployment.md`（Tunnel 作成・DNS は人間実行）

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
| Phase 4 | 📋 予定 | Cloudflare 公開（#5・人間実行） |
| Phase 5 | 🔄 進行中 | UI 仕上げ（Fable5 版デザイン模倣・#15）・実データ検証 |

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
