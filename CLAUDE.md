# CLAUDE.md — Utsunomiya Craft

JR宇都宮駅周辺の実地図データから、マインクラフト風（1ブロック=1m）のボクセル世界を生成し、ブラウザで一人称視点で歩き回れる個人用アプリ。three.js 製。
詳細仕様は `docs/SPEC.md`。**作業前に必ず読むこと。**

## 絶対制約（破らない）
- ゼロコスト・サーバーレス。実行時は静的ファイルのみ。有料API・バックエンド・アカウント必須サービスは使わない
- **実行時の依存は three.js のみ**。バンドラ不使用。素のES Modules + importmap
- three.js は `public/vendor/` に同梱する（CDN直リンク禁止）。バージョンを README に固定記録
- 実行時に外部データを取得しない。加工済みワールドデータをリポジトリにコミットして配信する
- すべて相対パス（GitHub Pages のサブパス配信で動くこと）
- 「Minecraft」の名称・テクスチャ・ロゴ・音源は使わない。テクスチャはCanvasで生成する
- 開発用ツール（Playwright等）は `tools/e2e/` 内の独立した package.json に隔離し、`public/` には絶対に持ち込まない

## ディレクトリ
```
tools/            データ加工スクリプト（Node, 開発時のみ）
  config.mjs fetch-osm.mjs build-world.mjs debug-preview.mjs
  e2e/            ヘッドレス検証用（独立 package.json）
public/           配信物（これだけをGitHub Pagesに載せる）
  index.html  src/  vendor/  world/
data/raw/         OSM生データのキャッシュ（15MB超なら .gitignore し、再取得手順を README に書く）
docs/SPEC.md      仕様
docs/decisions.md 判断ログ（1行1判断：日付・内容・理由）
```

## コマンド
- データ取得：`node tools/fetch-osm.mjs`
- ワールド生成：`node tools/build-world.mjs`
- 俯瞰PNG出力：`node tools/debug-preview.mjs`
- ローカル起動：`python3 -m http.server 8000 -d public`
- ユニットテスト：`node --test`（Node標準のテストランナー。テスト用ライブラリは入れない）
- スクリーンショット：`node tools/e2e/shot.mjs <name> [--x=.. --z=.. --yaw=..]`（Phase 1で作成）

## 開発ルール
1. **フェーズ単位で進める**。フェーズ完了時に必ずコミットする
2. **「動いた」と言う前に実行して確認する**。コードを書いただけで完了報告しない。確認方法は下記「検証」に従う
3. ロジックは**副作用のない純関数**に切り出す（ポリゴン塗り、座標変換、チャンク生成、衝突判定、スポーン探索）。three.js や DOM に依存しない部分は `node --test` で検証する
4. 判断に迷ったら質問で止まらず、SPEC.md の「判断指針」に従って決め、`docs/decisions.md` に1行記録する。ただし**仕様の根幹（制約・データソース・フェーズ範囲）を変える判断は止まって確認する**
5. スコープ外の機能を先取りしない。次フェーズの内容は実装しない
6. 新しい依存を追加しない。必要になったら理由を decisions.md に書いてから、ユーザーに確認する
7. 生成物のサイズを意識する。`public/world/` の合計と、リポジトリ全体（目標 50MB 以下）をフェーズ完了時に報告する

## 検証（必須）
- **データ**：`debug-preview.mjs` の俯瞰PNGを Read ツールで開いて目視確認する（画像は読める）。駅・線路・主要道路・駅前広場が現実と対応していること
- **ロジック**：`node --test` が通ること。特に衝突判定は「スポーン地点から全方向に歩いても壁抜け・床抜けしない」ことをテストで確認する
- **描画**：`tools/e2e/shot.mjs` で Playwright(Chromium) をヘッドレス起動し、スクリーンショットを撮って Read ツールで確認する。WebGL は SwiftShader で動かす（`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`）。ページは `?debug=1` でデバッグAPI（`window.__ready`、`window.__teleport(x,z,yaw)`、`window.__stats`）を公開する
- **性能**：ヘッドレス（ソフトウェア描画）のFPSは実機より大幅に低い。FPSの絶対値ではなく、チャンク生成時間・メッシュ頂点数・1フレームあたりの処理時間で評価し、実機FPSは「ユーザーに確認を依頼」として報告に書く
- フェーズ完了時は、実装に関与していない**レビュー用サブエージェント**に、SPEC.md の該当フェーズの合格基準だけを渡して独立に検証させる（コードの意図は伝えない）。指摘は修正してから完了報告する

## 完了報告の形式
フェーズ完了時に次をまとめる：
- 合格基準ごとの ✅/❌ と根拠（コマンド出力・スクリーンショットのパス）
- 決めたこと（decisions.md に追記した内容）
- 未解決・ユーザー確認が必要なこと（実機FPS、見た目の好み等）
- リポジトリ容量、`public/world/` 容量

## ライセンス表記（UIに常時表示・READMEにも記載）
- 「© OpenStreetMap contributors」（ODbL）
- Phase 2以降：「3D都市モデル（Project PLATEAU）国土交通省」
