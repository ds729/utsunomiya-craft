# 判断ログ（1行1判断：日付・内容・理由）

- 2026-10-07: 原点は `railway=station` `name=宇都宮` かつ operator に「東日本旅客鉄道」を含むノードの平均（在来線 3721336950 と新幹線 8173024298 の2点）とする — 同名ノードが2つあり、どちらか一方を恣意的に選ばないため。結果 lat=36.5592288, lon=139.8983323（`data/raw/station.json`）
- 2026-10-07: 範囲は `EXTENT {west,east,north,south}` で方向別に持ち、取得時は外側に100mの余白を付ける — 東西のみ拡張する仕様に対応し、境界のポリゴン欠けを防ぐため
- 2026-10-07: Overpass は1クエリ（`out geom`）で全要素を取得し、失敗時は bbox を4分割して最大2段まで再帰する — 2km四方で約5MBと小さく、1回で取れたため
- 2026-10-07: data/raw/osm.json（約5MB）は15MB未満なのでコミットする
- 2026-10-07: 道路幅は width → lanes×3.25m（車道のみ）→ 種別の既定値（SPEC の値に加え、trunk 14 / unclassified 6 / living_street 5 / pedestrian 4 / track 3 / steps 2 等）— SPEC に無い種別を埋めるため
- 2026-10-07: 歩道の自動付与は motorway/trunk/primary/secondary（とその link）で、sidewalk=no/none/separate は除く — separate は歩道が別 way で描かれるため
- 2026-10-07: 道路の塗り順は「全主要道路の歩道 → 細い順に車道」とし、歩道材の細道は車道セルを上書きしない — 交差点で歩道や歩行路が車道を分断しないため
- 2026-10-07: 地表の面の優先度は urban < farmland/railway < park/forest < water < parking < plaza < platform。その上に水路線 → 道路 → 線路を重ねる — 小さく具体的なものほど後に塗るため
- 2026-10-07: 線路は1本の way につき幅4mのバラスト＋中央1.5mのレール材、tram は幅3mの専用材質（TRAM）とする — 俯瞰図と歩行時にライトラインを見分けやすくするため
- 2026-10-07: tunnel が no 以外の値、または layer<0 の道路・線路は描かない — SPEC の tunnel=yes 除外に加え、アンダーパスや building_passage も地表に出さないため
- 2026-10-07: 高架は「bridge≠no かつ layer>=1」の線、man_made=bridge の面、layer>=1 の広場・ホーム面を deck に書く。下面高さは layer×6m（上限30m）で、重なる場合は低い方を採用する。高架の線の下の地表は塗らない — ペデストリアンデッキ（layer1→6m）と新幹線高架（layer2→12m）を区別でき、重なりでは歩ける側を優先するため
- 2026-10-07: 建物の既定高さ：house 系 6 / apartments・hotel 15 / commercial・retail 12 / office 15 / train_station 15 / industrial 8 / 公共 12 / 小屋・車庫 3 / roof・carport 4 / yes・その他 8 [m]。levels は ×3m に roof:levels×3m を加える — SPEC の住宅6m・商業12m を基準に補完するため
- 2026-10-07: 100mを超える高層（宇都宮PEAKS 108m など）は MAX_H=96 でクランプする（SPEC どおり）
- 2026-10-07: 建物は外形 way/relation を先に塗り、building:part で上書きする（高さ違いを反映）。multipolygon は outer/inner を区別せずリング化し、偶奇規則で塗る — 内周の向きや順序が不揃いでも穴が正しく抜けるため
- 2026-10-07: 俯瞰PNGは依存なしの自前エンコーダ（node:zlib）で出力する。出力先 data/preview/ は再生成できるのでコミットしない
- 2026-10-07: （レビュー指摘を受けて変更）鉄道の高架（bridge かつ layer>=1）は layer に関係なく下面12m・幅6mで deck に書き、道路デッキより後に上書きする — 新幹線高架の way ごとに layer が1と2で混在し、6mと12mの段差や、並行する way の間に1〜2セルの隙間ができていたため
- 2026-10-07: 俯瞰PNGで駅舎（train_station）の色を、デッキのマゼンタと区別できる青緑に変更する
- 2026-10-07: layer>=1 のホーム面（新幹線ホーム）も下面12mに揃える — layer=1 のため6mになり、高架の両脇に段差ができていたため
