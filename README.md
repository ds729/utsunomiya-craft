# Utsunomiya Craft

JR宇都宮駅周辺の OpenStreetMap データから、1ブロック=1m のボクセル世界を生成してブラウザで歩き回る個人用アプリ（開発中：Phase 0 データ検証まで）。

仕様：[docs/SPEC.md](docs/SPEC.md)／判断ログ：[docs/decisions.md](docs/decisions.md)

## データの再生成
```
node tools/fetch-osm.mjs          # OSM 取得（data/raw/ にキャッシュ。再取得は --force）
node tools/build-world.mjs        # public/world/*.bin, world.json を生成
node tools/debug-preview.mjs      # 俯瞰PNG → data/preview/overview.png
node tools/debug-preview.mjs --x=0 --z=0 --r=300 --scale=3 --out=station --highlight=大通り,鬼怒通り
node --test                       # ユニットテスト
```
Node.js 20 以降（開発時は v26 で確認）。実行時の依存はありません（three.js は Phase 1 で `public/vendor/` に同梱予定）。

## ライセンス・出典
- 地図データ：© OpenStreetMap contributors（ODbL 1.0）。`public/world/` と `data/raw/` は OSM から加工・取得したデータで、ODbL が適用されます。上記の手順で再生成できます
- 「Minecraft」とは無関係の独自プロジェクトです
