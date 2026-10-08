# Utsunomiya Craft

JR宇都宮駅周辺の OpenStreetMap データから、1ブロック=1m のボクセル世界を生成してブラウザで歩き回る個人用アプリ（開発中：Phase 1 歩ける世界まで）。

仕様：[docs/SPEC.md](docs/SPEC.md)／判断ログ：[docs/decisions.md](docs/decisions.md)

## 遊び方
```
python3 -m http.server 8000 -d public
```
ブラウザで http://localhost:8000/ を開き、画面をクリックして開始。

| 操作 | キー |
|---|---|
| 移動 | W A S D（矢印キーも可） |
| ダッシュ | Shift（8m/s。歩行は4.3m/s） |
| ジャンプ | Space（1段の段差を登れる） |
| フライ切替 | Space を素早く2回（フライ中は Space 上昇／Shift 下降） |
| 描画距離 | `[` `]`（URL の `?view=8` でも指定、2〜16チャンク） |
| マウス解放 | Esc |

スポーンは JR宇都宮駅 東口。駅・ペデストリアンデッキ・新幹線高架の上へはフライで上がる（階段は未実装）。

## GitHub Pages への配置
`public/` の中身だけを配信すればよい（すべて相対パス。サブパス配信でも動作確認済み）。実行時の外部通信はなし。

## データの再生成
```
node tools/fetch-osm.mjs          # OSM 取得（data/raw/ にキャッシュ。再取得は --force）
node tools/build-world.mjs        # public/world/*.bin.gz, world.json を生成
node tools/debug-preview.mjs      # 俯瞰PNG → data/preview/overview.png
node tools/debug-preview.mjs --x=0 --z=0 --r=300 --scale=3 --out=station --highlight=大通り,鬼怒通り
node --test                       # ユニットテスト（実データでの歩行テストを含む）
```
Node.js 20 以降（開発時は v26 で確認）。

## ヘッドレス描画確認（開発用）
```
cd tools/e2e && npm install && npx playwright install chromium && cd ../..
node tools/e2e/shot.mjs east --x=88 --z=-31 --yaw=270            # 地点・方位[度]を指定して撮影
node tools/e2e/shot.mjs aerial --x=0 --z=0 --y=80 --pitch=-40     # 空中から
node tools/e2e/shot.mjs sub --base=/utsunomiya-craft/             # サブパス配信の確認
```
出力は `tools/e2e/shots/`。ページは `?debug=1` で `window.__ready` / `__teleport(x, z, yaw)` / `__stats` を公開する。

## 依存
- 実行時：**three.js 0.186.1**（`public/vendor/three.module.js`, `three.core.js`。MIT、`public/vendor/three.LICENSE`）。CDN は使わない
- 開発時のみ：Playwright 1.63.0（`tools/e2e/` に隔離。`public/` には含めない）

## ライセンス・出典
- 地図データ：© OpenStreetMap contributors（ODbL 1.0）。`public/world/` と `data/raw/` は OSM から加工・取得したデータで、ODbL が適用されます。上記の手順で再生成できます
- テクスチャはすべて Canvas でプログラム生成しています
- 「Minecraft」とは無関係の独自プロジェクトです
