# 東京メトロ 3D運行可視化Webアプリ 詳細設計仕様書

## 1. 文書情報

| 項目     | 内容                                  |
| ------ | ----------------------------------- |
| 文書名    | 東京メトロ 3D運行可視化Webアプリ 詳細設計仕様書         |
| 対象システム | Tokyo Metro 3D Operation Visualizer |
| 対象フェーズ | PoC〜評価公開版                           |
| 作成日    | 2026-07-04                          |

---

## 2. システム構成

## 2.1 全体アーキテクチャ

```text
┌──────────────────────────────┐
│ ODPT / GTFS / GTFS-RT         │
│ - 東京メトロGTFS              │
│ - 東京メトロGTFS-RT            │
└───────────────┬──────────────┘
                │ HTTPS
                ↓
┌──────────────────────────────┐
│ Ubuntu Server                 │
│                              │
│ backend/                      │
│ - GTFS fetcher                │
│ - GTFS-RT fetcher             │
│ - protobuf decoder            │
│ - normalizer                  │
│ - cache store                 │
│ - REST API                    │
└───────────────┬──────────────┘
                │ localhost
                ↓
┌──────────────────────────────┐
│ cloudflared                   │
│ Cloudflare Tunnel             │
└───────────────┬──────────────┘
                │
                ↓
┌──────────────────────────────┐
│ Cloudflare                    │
│ api.<domain>                  │
└───────────────┬──────────────┘
                │ HTTPS JSON
                ↓
┌──────────────────────────────┐
│ Cloudflare Pages              │
│ viz.<domain>                  │
│                              │
│ frontend/                     │
│ - Three.js                    │
│ - 3D route view               │
│ - train animation             │
│ - alert panel                 │
└──────────────────────────────┘
```

Cloudflare Pagesはカスタムドメイン設定でサブドメインをPagesプロジェクトへ割り当て可能であり、Cloudflare TunnelはTunnel用CNAMEを通じてホスト名からローカルサービスへルーティングできる。

---

## 3. 採用技術

| 区分          | 採用候補                               | 理由                              |
| ----------- | ---------------------------------- | ------------------------------- |
| フロントエンド     | TypeScript + Vite                  | Claude Codeで扱いやすく、Three.js構成に向く |
| 3D描画        | Three.js                           | WebGLベースの3D表示に適する               |
| UI          | HTML/CSS + 軽量コンポーネント               | PoC段階では過剰なUIフレームワークを避ける         |
| バックエンド      | Node.js LTS + TypeScript + Fastify | フロントと同じ言語で統一しやすい                |
| GTFS-RTデコード | gtfs-realtime-bindings系ライブラリ       | Protocol Buffersのデコードを簡略化       |
| キャッシュ       | JSONファイル + SQLite任意                | 初期は軽量に開始し、必要に応じDB化              |
| 常駐管理        | systemd service / timer            | Ubuntu常時稼働と相性が良い                |
| 公開          | Cloudflare Pages / Tunnel          | フロント公開とAPI公開を分離しやすい             |

---

## 4. ディレクトリ構成

```text
Tokyo-Metro-3D-Operation-Visualizer/
├─ README.md
├─ .env.example
├─ docs/
│  ├─ requirements.md
│  ├─ detailed-design.md
│  ├─ api-spec.md
│  └─ data-policy.md
├─ frontend/
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ src/
│  │  ├─ main.ts
│  │  ├─ config/
│  │  │  └─ appConfig.ts
│  │  ├─ api/
│  │  │  └─ metroApi.ts
│  │  ├─ three/
│  │  │  ├─ scene.ts
│  │  │  ├─ camera.ts
│  │  │  ├─ routeLayer.ts
│  │  │  ├─ stationLayer.ts
│  │  │  ├─ trainLayer.ts
│  │  │  └─ labelLayer.ts
│  │  ├─ ui/
│  │  │  ├─ sidePanel.ts
│  │  │  ├─ statusBar.ts
│  │  │  └─ legend.ts
│  │  └─ types/
│  │     └─ metro.ts
│  └─ public/
├─ backend/
│  ├─ package.json
│  ├─ src/
│  │  ├─ server.ts
│  │  ├─ config.ts
│  │  ├─ routes/
│  │  │  ├─ health.ts
│  │  │  ├─ routes.ts
│  │  │  ├─ stations.ts
│  │  │  ├─ realtime.ts
│  │  │  └─ alerts.ts
│  │  ├─ services/
│  │  │  ├─ gtfsFetcher.ts
│  │  │  ├─ gtfsRtFetcher.ts
│  │  │  ├─ protobufDecoder.ts
│  │  │  ├─ normalizer.ts
│  │  │  └─ cacheStore.ts
│  │  ├─ domain/
│  │  │  ├─ routeModel.ts
│  │  │  ├─ stationModel.ts
│  │  │  └─ trainModel.ts
│  │  └─ utils/
│  │     ├─ logger.ts
│  │     ├─ geo.ts
│  │     └─ validation.ts
│  └─ data/
│     ├─ raw/
│     ├─ normalized/
│     └─ cache/
├─ scripts/
│  ├─ fetch-gtfs.ts
│  ├─ fetch-gtfs-rt.ts
│  ├─ normalize-static.ts
│  └─ validate-data.ts
└─ systemd/
   ├─ metro3d-api.service
   ├─ metro3d-fetch.service
   └─ metro3d-fetch.timer
```

---

## 5. 環境変数設計

| 変数名                      | 内容               | 例                      |
| ------------------------ | ---------------- | ---------------------- |
| `NODE_ENV`               | 実行環境             | `production`           |
| `PORT`                   | API待受ポート         | `3000`                 |
| `ODPT_API_TOKEN`         | ODPT APIアクセストークン | `xxxxxxxx`             |
| `ODPT_GTFS_URL`          | GTFS取得URL        | 開発者サイト確認後に設定           |
| `ODPT_GTFS_RT_URL`       | GTFS-RT取得URL     | 開発者サイト確認後に設定           |
| `FRONTEND_ORIGIN`        | CORS許可オリジン       | `https://viz.<domain>` |
| `CACHE_DIR`              | キャッシュ保存先         | `./data/cache`         |
| `FETCH_INTERVAL_SECONDS` | RT取得間隔           | `15`                   |
| `LOG_LEVEL`              | ログレベル            | `info`                 |

注意: `ODPT_API_TOKEN` はフロントエンドに含めない。

---

## 6. データ処理設計

## 6.1 静的GTFS処理

### 処理概要

1. GTFS zipを取得する。
2. `routes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt`, `shapes.txt` を読み込む。
3. 必須項目の存在確認を行う。
4. 緯度経度の異常値を除外する。
5. 路線、駅、停車順、形状情報を内部JSONへ変換する。
6. フロント表示用の軽量JSONを生成する。

### 正規化後データ

```text
backend/data/normalized/
├─ routes.json
├─ stations.json
├─ route-shapes.json
├─ stop-sequences.json
└─ metadata.json
```

---

## 6.2 GTFS-RT処理

### 処理概要

1. ODPT GTFS-RTエンドポイントへアクセスする。
2. Protocol Buffers形式のレスポンスを取得する。
3. GTFS-RTデコーダーでFeedMessageへ変換する。
4. `vehicle`, `trip_update`, `alert` を可能な範囲で抽出する。
5. 静的GTFSデータと突合する。
6. 列車位置、遅延、アラートを内部JSONへ変換する。
7. キャッシュへ保存する。

GTFS Realtimeのデータ交換形式はProtocol Buffersに基づくため、バックエンド側でデコードしてからフロント用JSONへ変換する。

---

## 6.3 データクレンジング仕様

| 対象   | チェック内容               | 対応                  |
| ---- | -------------------- | ------------------- |
| 駅座標  | 緯度経度が空、0、東京圏外        | 除外または警告             |
| 路線ID | 未定義路線                | `unknownRoute`として隔離 |
| 駅ID  | stop_timesに存在しない駅    | 警告ログ出力              |
| 列車情報 | trip_idが静的GTFSに存在しない | 表示対象外または暫定表示        |
| 更新時刻 | 古すぎるリアルタイムデータ        | stale扱い             |
| 重複   | 同一列車IDの重複            | 最新タイムスタンプを採用        |
| 文字列  | 駅名・路線名の空白、制御文字       | トリム・除去              |

---

## 7. 内部データモデル

## 7.1 Route

```ts
type MetroRoute = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor?: string;
  layerHeight: number;
  visible: boolean;
};
```

---

## 7.2 Station

```ts
type MetroStation = {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
  routeIds: string[];
};
```

---

## 7.3 RouteShape

```ts
type MetroRouteShape = {
  routeId: string;
  points: Array<{
    lat: number;
    lon: number;
    x: number;
    y: number;
    z: number;
    sequence: number;
  }>;
};
```

---

## 7.4 Train

```ts
type MetroTrain = {
  trainId: string;
  tripId?: string;
  routeId?: string;
  directionId?: string;
  status: "normal" | "delay" | "suspended" | "unknown";
  delaySeconds?: number;
  lat?: number;
  lon?: number;
  x: number;
  y: number;
  z: number;
  currentStationId?: string;
  nextStationId?: string;
  positionSource: "gtfs-rt" | "interpolated" | "station-based" | "mock";
  updatedAt: string;
};
```

---

## 7.5 Alert

```ts
type MetroAlert = {
  alertId: string;
  routeIds: string[];
  stationIds?: string[];
  severity: "info" | "warning" | "critical";
  title: string;
  description?: string;
  activePeriod?: {
    start?: string;
    end?: string;
  };
};
```

---

## 8. 座標変換設計

## 8.1 基本方針

GTFSの緯度経度をThree.js空間座標へ変換する。

| 実世界   | Three.js |
| ----- | -------- |
| 経度    | X軸       |
| 緯度    | Z軸       |
| 路線別高さ | Y軸       |

要件文では「Z軸高さ」と表現しているが、Three.jsでは一般的にY軸を上下方向として扱うため、実装上はY軸を高さとして採用する。画面仕様上は「路線別高さ」と表現する。

---

## 8.2 変換式

```text
centerLat = 東京メトロエリア中心緯度
centerLon = 東京メトロエリア中心経度

x = (lon - centerLon) * scale * cos(centerLat)
z = -(lat - centerLat) * scale
y = routeLayerHeight
```

---

## 8.3 路線高さ

| 路線   | layerHeight例 |
| ---- | -----------: |
| 銀座線  |            0 |
| 丸ノ内線 |           10 |
| 日比谷線 |           20 |
| 東西線  |           30 |
| 千代田線 |           40 |
| 有楽町線 |           50 |
| 半蔵門線 |           60 |
| 南北線  |           70 |
| 副都心線 |           80 |

実際の高さ値は見やすさ優先で調整する。

---

## 9. API設計

## 9.1 共通仕様

| 項目    | 内容                     |
| ----- | ---------------------- |
| 形式    | JSON                   |
| 文字コード | UTF-8                  |
| 認証    | 初期版は公開API。ただし管理APIは非公開 |
| CORS  | `FRONTEND_ORIGIN` のみ許可 |
| キャッシュ | 静的データは長め、RTデータは短め      |
| エラー形式 | 共通エラーレスポンス             |

---

## 9.2 共通レスポンス

```ts
type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  meta: {
    generatedAt: string;
    sourceUpdatedAt?: string;
    stale: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
};
```

---

## 9.3 エンドポイント一覧

| メソッド | パス                     | 内容              |
| ---- | ---------------------- | --------------- |
| GET  | `/api/health`          | API稼働状態         |
| GET  | `/api/routes`          | 路線一覧            |
| GET  | `/api/stations`        | 駅一覧             |
| GET  | `/api/route-shapes`    | 路線形状            |
| GET  | `/api/realtime/trains` | 列車リアルタイム情報      |
| GET  | `/api/realtime/alerts` | アラート情報          |
| GET  | `/api/status`          | データ取得状態         |
| POST | `/api/admin/refetch`   | 手動再取得。初期はローカル限定 |

---

## 9.4 `/api/health`

### レスポンス例

```json
{
  "ok": true,
  "data": {
    "service": "metro3d-api",
    "status": "healthy",
    "uptimeSeconds": 12345
  },
  "meta": {
    "generatedAt": "2026-07-04T05:00:00.000Z",
    "stale": false
  }
}
```

---

## 9.5 `/api/realtime/trains`

### レスポンス例

```json
{
  "ok": true,
  "data": [
    {
      "trainId": "train-001",
      "tripId": "trip-xxx",
      "routeId": "G",
      "status": "delay",
      "delaySeconds": 180,
      "x": 120.5,
      "y": 0,
      "z": -80.2,
      "currentStationId": "G-10",
      "nextStationId": "G-11",
      "positionSource": "interpolated",
      "updatedAt": "2026-07-04T05:00:00.000Z"
    }
  ],
  "meta": {
    "generatedAt": "2026-07-04T05:00:05.000Z",
    "sourceUpdatedAt": "2026-07-04T05:00:00.000Z",
    "stale": false
  }
}
```

---

## 10. フロントエンド設計

## 10.1 画面構成

```text
┌────────────────────────────────────────┐
│ Header                                 │
│ Tokyo Metro 3D Operation Visualizer     │
│ API: OK / Last Update: HH:mm:ss         │
├──────────────┬─────────────────────────┤
│ Left Panel   │ 3D View                  │
│ - Lines      │ - Routes                 │
│ - Filters    │ - Stations               │
│ - Layers     │ - Trains                 │
│              │ - Labels                 │
├──────────────┴──────────────┬──────────┤
│ Footer / Legend / Source    │ Alert    │
└─────────────────────────────┴──────────┘
```

---

## 10.2 3Dレイヤー

| レイヤー          | 内容     | 実装                            |
| ------------- | ------ | ----------------------------- |
| BaseGridLayer | 背景グリッド | Three.js GridHelper           |
| RouteLayer    | 路線ライン  | Line2またはTubeGeometry          |
| StationLayer  | 駅ノード   | SphereGeometry                |
| TrainLayer    | 列車     | BoxGeometryまたはCapsule風        |
| LabelLayer    | 駅名・路線名 | CSS2DRendererまたはCanvasTexture |
| AlertLayer    | アラート強調 | 点滅・縁取り・パネル連動                  |

---

## 10.3 表示色ルール

| 状態      | 表示         |
| ------- | ---------- |
| 通常      | 路線色または通常色  |
| 遅延      | 黄色系の警告表示   |
| 運休・見合わせ | 赤系の強調表示    |
| 不明      | グレー表示      |
| データ古い   | 半透明または点線表示 |

具体的な色値は `frontend/src/config/appConfig.ts` で管理する。

---

## 10.4 操作仕様

| 操作      | 内容         |
| ------- | ---------- |
| マウスドラッグ | カメラ回転      |
| ホイール    | ズーム        |
| 右ドラッグ   | パン         |
| 駅クリック   | 駅情報表示      |
| 列車クリック  | 列車詳細表示     |
| 路線チェック  | 表示ON/OFF   |
| リセットボタン | 初期カメラ位置へ戻す |

---

## 11. バックエンド処理設計

## 11.1 起動時処理

1. `.env` を読み込む。
2. 必須環境変数を検証する。
3. normalizedデータの存在を確認する。
4. 存在しない場合は静的GTFS取得を促す。
5. cacheデータを読み込む。
6. APIサーバーを起動する。
7. GTFS-RT定期取得ジョブを開始する。

---

## 11.2 GTFS-RT定期取得処理

```text
timer start
  ↓
fetch GTFS-RT protobuf
  ↓
decode FeedMessage
  ↓
validate entities
  ↓
join with static GTFS
  ↓
normalize train / alert
  ↓
write cache
  ↓
update status
```

---

## 11.3 エラー処理

| エラー            | 対応                                         |
| -------------- | ------------------------------------------ |
| ODPT接続失敗       | 前回キャッシュを継続利用                               |
| 認証エラー          | API状態をcriticalにする                          |
| protobufデコード失敗 | raw保存、エラーログ出力                              |
| 静的GTFS不一致      | 対象データを隔離                                   |
| キャッシュ書込失敗      | APIはメモリ上の前回データを返す                          |
| Tunnel停止       | Cloudflare側では1016等の可能性があるため、復旧手順をREADMEに記載 |

Cloudflare Tunnelでは、DNSレコードとTunnelは独立しており、Tunnel停止時にDNSレコードは削除されず、訪問者側ではエラーになる可能性がある。

---

## 12. systemd設計

## 12.1 APIサービス

### `metro3d-api.service`

```ini
[Unit]
Description=Tokyo Metro 3D API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/metro3d/backend
EnvironmentFile=/opt/metro3d/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
User=metro3d
Group=metro3d

[Install]
WantedBy=multi-user.target
```

---

## 12.2 データ取得タイマー

### `metro3d-fetch.timer`

```ini
[Unit]
Description=Fetch Tokyo Metro GTFS-RT periodically

[Timer]
OnBootSec=30
OnUnitActiveSec=15
Unit=metro3d-fetch.service

[Install]
WantedBy=timers.target
```

---

## 12.3 データ取得サービス

### `metro3d-fetch.service`

```ini
[Unit]
Description=Fetch Tokyo Metro GTFS-RT

[Service]
Type=oneshot
WorkingDirectory=/opt/metro3d/backend
EnvironmentFile=/opt/metro3d/.env
ExecStart=/usr/bin/npm run fetch:realtime
User=metro3d
Group=metro3d
```

---

## 13. Cloudflare設計

## 13.1 サブドメイン

| サブドメイン            | 用途                      |
| ----------------- | ----------------------- |
| `viz.<domain>`    | Cloudflare Pagesの3Dフロント |
| `api.<domain>`    | Cloudflare Tunnel経由のAPI |
| `status.<domain>` | 将来のステータス画面。任意           |

---

## 13.2 Pages設定

| 項目               | 内容                                       |
| ---------------- | ---------------------------------------- |
| Build command    | `npm run build`                          |
| Output directory | `dist`                                   |
| Root directory   | `frontend`                               |
| Environment      | `VITE_API_BASE_URL=https://api.<domain>` |
| Custom domain    | `viz.<domain>`                           |

---

## 13.3 Tunnel設定

```text
api.<domain>
  ↓ CNAME
<UUID>.cfargotunnel.com
  ↓
cloudflared on Ubuntu
  ↓
localhost:3000
```

Cloudflare Tunnelでは、CLIで `cloudflared tunnel route dns <UUID or NAME> www.app.com` を実行してTunnel向けCNAMEを作成できる。

---

## 14. セキュリティ設計

## 14.1 APIキー保護

| 項目     | 内容                                          |
| ------ | ------------------------------------------- |
| 保存場所   | Ubuntu上の `.env` または systemd EnvironmentFile |
| フロント露出 | 禁止                                          |
| Git管理  | `.env` は `.gitignore` 対象                    |
| サンプル   | `.env.example` のみ管理                         |
| ログ出力   | APIキーをマスクする                                 |

---

## 14.2 CORS

```text
許可:
- https://viz.<domain>

拒否:
- その他Origin
```

---

## 14.3 管理API

| API               | 公開可否                         |
| ----------------- | ---------------------------- |
| `/api/health`     | 公開可                          |
| `/api/routes`     | 公開可                          |
| `/api/stations`   | 公開可                          |
| `/api/realtime/*` | 公開可。ただし利用条件確認後               |
| `/api/status`     | 公開または制限                      |
| `/api/admin/*`    | ローカル限定またはCloudflare Access必須 |

---

## 15. ログ設計

## 15.1 ログ種別

| ログ            | 内容           |
| ------------- | ------------ |
| access.log    | APIアクセス      |
| fetch.log     | データ取得結果      |
| normalize.log | データ変換・クレンジング |
| error.log     | 例外・異常        |
| audit.log     | 管理操作         |

---

## 15.2 ログ項目

| 項目         | 内容                         |
| ---------- | -------------------------- |
| timestamp  | 発生時刻                       |
| level      | info / warn / error        |
| module     | fetcher / api / normalizer |
| message    | 内容                         |
| source     | GTFS / GTFS-RT / API       |
| durationMs | 処理時間                       |
| count      | 処理件数                       |
| errorCode  | エラーコード                     |

---

## 16. テスト設計

## 16.1 単体テスト

| 対象                 | テスト            |
| ------------------ | -------------- |
| geo.ts             | 緯度経度から3D座標への変換 |
| validation.ts      | 欠損・異常値検出       |
| protobufDecoder.ts | GTFS-RTデコード    |
| normalizer.ts      | 内部モデル変換        |
| cacheStore.ts      | キャッシュ読書き       |

---

## 16.2 結合テスト

| テスト        | 内容                                      |
| ---------- | --------------------------------------- |
| GTFS取得     | 静的データ取得と正規化が完了する                        |
| GTFS-RT取得  | protobuf取得・デコード・JSON化が完了する              |
| API        | `/api/routes` 等が正常レスポンスを返す              |
| フロント       | APIデータを使って3D表示できる                       |
| Cloudflare | `viz.<domain>` から `api.<domain>` を取得できる |

---

## 16.3 異常系テスト

| 条件            | 期待結果              |
| ------------- | ----------------- |
| ODPT API停止    | 前回キャッシュで表示継続      |
| APIキー不正       | healthでcritical表示 |
| GTFS-RTデコード失敗 | エラーログ記録、前回データ継続   |
| Tunnel停止      | フロントでAPI接続不可表示    |
| データ古い         | stale表示           |
| 駅座標欠損         | 対象駅を除外または警告表示     |

---

## 17. README記載方針

README.mdには、非エンジニアにも分かるように以下を記載する。

| 項目     | 内容                           |
| ------ | ---------------------------- |
| システム概要 | 何を表示するアプリか                   |
| 画面イメージ | 3D路線図のスクリーンショット              |
| 構成図    | Cloudflare + Ubuntu + ODPTの図 |
| セットアップ | フロント、バックエンド、systemd          |
| 環境変数   | `.env.example`               |
| データ出典  | ODPT、東京メトロ、GTFS / GTFS-RT    |
| 免責事項   | 非公式PoC、正確性非保証                |
| 運用方法   | 起動、停止、ログ確認                   |
| トラブル対応 | API不可、Tunnel停止、データ取得失敗       |

---

## 18. 免責表示案

本アプリは、公共交通オープンデータを活用した非公式の可視化PoCです。
表示される運行情報、列車位置、遅延情報は参考表示であり、正確性・完全性・即時性を保証するものではありません。
実際の運行情報は、東京メトロその他交通事業者の公式情報を確認してください。

---

## 19. 実装順序

|  順 | 作業                 | 完了条件                       |
| -: | ------------------ | -------------------------- |
|  1 | リポジトリ初期化           | frontend/backend/docs構成がある |
|  2 | ダミーデータ3D表示         | 疑似路線・駅・列車が表示される            |
|  3 | API基本実装            | `/api/health` が返る          |
|  4 | GTFS静的データ正規化       | 実駅・実路線を表示できる               |
|  5 | GTFS-RT取得・デコード     | JSON化できる                   |
|  6 | 列車表示連携             | RTまたは補間列車が表示される            |
|  7 | Cloudflare Pages公開 | `viz.<domain>` で表示できる      |
|  8 | Tunnel公開           | `api.<domain>` でAPI取得できる   |
|  9 | UI改善               | 凡例、フィルタ、アラート表示             |
| 10 | README整備           | 第三者が起動できる説明がある             |

---

## 20. Claude Code実装時の禁止事項

1. APIキーをフロントエンドへ埋め込まない。
2. `.env` をGit管理しない。
3. ODPT利用条件を未確認のまま本番公開しない。
4. 正確な運行判断を保証する表現をしない。
5. 3D完全再現を初期スコープに入れない。
6. 巨大なJSONをそのままフロントへ渡さない。
7. データ取得失敗時に画面を真っ白にしない。
8. 管理APIを無制限公開しない。

---

## 21. 将来拡張

| 拡張         | 内容                    |
| ---------- | --------------------- |
| WebSocket化 | 短周期ポーリングからリアルタイム配信へ変更 |
| 複数事業者対応    | 都営地下鉄、JR、私鉄などへ拡張      |
| 時系列リプレイ    | 過去の運行状態を再生            |
| 混雑推定       | 公開可能データがある場合のみ検討      |
| 3D駅構内表示    | 主要駅のみ簡易3Dモデル化         |
| PWA化       | スマホ・タブレットでの閲覧性向上      |
| アラート通知     | 運行障害時の通知              |
| ダッシュボード    | 遅延路線数、取得状況、更新頻度を表示    |
