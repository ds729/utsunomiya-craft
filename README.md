# Utsunomiya Craft

JR宇都宮駅周辺の OpenStreetMap データから、1ブロック=1m のボクセル世界を生成してブラウザで歩き回る個人用アプリ（Phase 3 仕上げまで: 起伏・Web Worker・ライトライン・装飾）。

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
| ジャンプ | Space（1段の段差は歩くだけでも自動で上がる。2段は登れない） |
| フライ切替 | Space を素早く2回（フライ中は Space 上昇／Shift 下降） |
| 壊す／置く | 左クリック／右クリック（届くのは6mまで。岩盤は壊せない） |
| ブロック選択 | 1〜9、マウスホイール |
| 地図 | M（右上のミニマップ ⇔ 全体地図） |
| テレポート・一時停止 | T または Esc（駅東口・西口・ライトライン停留場・餃子像・大通りなど） |
| 描画距離 | `[` `]`（URL の `?view=8` でも指定、2〜16チャンク） |

- スマホ・タブレット：左のスティックで移動（端まで倒すとダッシュ）、右半分のドラッグで視点、ボタンでジャンプ（2回でフライ）・下降・壊す・置く、≡ でメニュー
- 昼夜：ゲーム内の1日は実時間20分（10:00 から開始。URL の `?time=18` で開始時刻を指定）
- 編集したブロックはブラウザ（IndexedDB）にチャンク単位で保存され、再読み込みしても残る。一時停止メニューの「編集をすべて元に戻す」で消せる
- マウスを固定できない環境では、ドラッグで視点、クリックで壊す

スポーンは JR宇都宮駅 東口。地形は国土地理院の標高にもとづく緩やかな起伏（標高104〜143m、北西の八幡山が高い）。ペデストリアンデッキへは階段（東口1か所・西口側9か所）で上がれ、縁には手すりがある。駅舎・新幹線高架の上へはフライで。

ライトライン（宇都宮芳賀ライトレール線）が駅東口〜範囲の東端を走る（2編成、停留場で停車、終点で折り返し）。車両は見た目だけで、ぶつからない。

## GitHub Pages への配置
`public/` の中身だけを配信すればよい（すべて相対パス。サブパス配信でも動作確認済み）。実行時の外部通信はなし。

## データの再生成
```
node tools/fetch-osm.mjs          # OSM 取得（data/raw/ にキャッシュ。再取得は --force）
node tools/fetch-plateau.mjs      # PLATEAU 建物（範囲内の3次メッシュ12枚だけを Range 取得、転送約24MB → data/raw/plateau/、コミットしない）
node tools/fetch-dem.mjs          # 国土地理院 標高タイル（DEM5A z15 ×9、DEM10B z14 ×4 → data/raw/dem/、約5.6MB、コミット済み）
node tools/build-world.mjs --plateau --dem  # public/world/*.bin.gz, world.json を生成（--plateau なしなら OSM の高さのみ、--dem なしなら平坦、--no-decor で装飾なし）
node tools/debug-preview.mjs      # 俯瞰PNG → data/preview/overview.png
node tools/debug-preview.mjs --elev --scale=0.5 --out=elev  # 地表の高さ（段彩・陰影・2ブロックごとの等高線）
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
node tools/e2e/shot.mjs edit --pitch=-40 --act=break,place:7 --reload  # 編集と保存の確認
node tools/e2e/shot.mjs night --time=21 / --map / --pause / --touch   # 夜・全体地図・メニュー・スマホ表示
node tools/e2e/shot.mjs tram --x=530 --z=122 --yaw=290 --tram=105    # ライトラインの運行時刻[秒]を指定（東宿郷に停車中）
node tools/e2e/shot.mjs perf --x=600 --z=-600 --view=10 --worker=0   # チャンク生成を本スレッドで（Worker との比較。__stats.stream に読み込み中のフレーム時間）
```
出力は `tools/e2e/shots/`。ページは `?debug=1` で `window.__ready` / `__teleport(x, z, yaw)` / `__stats` / `__tramTime(秒)` を公開する。チャンク生成は Web Worker（`public/src/mesh-worker.js`）で行い、`?worker=0` で本スレッドに切り替えられる。

## 依存
- 実行時：**three.js 0.186.1**（`public/vendor/three.module.js`, `three.core.js`。MIT、`public/vendor/three.LICENSE`）。CDN は使わない
- 開発時のみ：Playwright 1.63.0（`tools/e2e/` に隔離。`public/` には含めない）

## ライセンス・出典
- 地図データ：© OpenStreetMap contributors（ODbL 1.0）。`public/world/` と `data/raw/` は OSM から加工・取得したデータで、ODbL が適用されます。上記の手順で再生成できます
- 標高：国土地理院 標高タイル（基盤地図情報 数値標高モデル DEM5A / DEM10B、https://maps.gsi.go.jp/development/ichiran.html ）を加工して利用。`data/raw/dem/` は取得したままのタイル
- 建物の高さ：3D都市モデル（Project PLATEAU）国土交通省（宇都宮市 2023年度版、CC BY 4.0 相当の PLATEAU サイトポリシーに基づき加工して利用）。出典：https://www.geospatial.jp/ckan/dataset/plateau-09201-utsunomiya-shi-2023
- テクスチャはすべて Canvas でプログラム生成しています
- 「Minecraft」とは無関係の独自プロジェクトです
