# 残課題パス — doc トラック（2026-10-04、`rem/doc`）

コンセプトの「一度だけ省トークンで読む → 読める設計書 → 初見者が分かり、専門家が細部を詰める」のうち、
**0 トークンで出せる中身**と**同じ commit なら同じ結果**を詰めた。LLM 消費は **$0**（実エンジンは使っていない）。
契約の変更は `packages/core/CR-LEDGER.md` §8（CR rdoc-1〜4）、他トラックへの依頼は `docs/design/cr-requests/doc.md`。

## 1. 何が変わったか（タスク別）

| # | タスク | 状態 | 中身 · 回帰テスト |
|---|---|---|---|
| 1 | NC-10 §7 主要な型・§8 外とのやり取り | **済** | §7 `s7:types`（型・種類・定義・フィールド数・「持っている型」・使うファイル数）+ `s7:types-map`（フィールドの型でつないだ図）を DB スキーマの前に。§8 `s8:outbound`（HTTP / RPC / SDK / DB / 子プロセスを 種類 × 相手 × ライブラリ で 1 行、場所は 3 か所 + ほか n 件）と `s8:secrets`（秘密情報らしい環境変数の名前と読む場所。値は読まない）。新しい事実 `outbound`（`outbound.calls@1`、TS/JS・Go・Python・Rust、import が無ければ数えない）。`facts.test.ts`（言語ごとの形と罠、fixture の実呼び出し）・`static-deep.test.ts`・`doc-deep.test.ts` |
| 2 | 横断的な「変更の手引き」 | **済**（co-change は履歴のある clone だけ） | module 章の `m:<id>:change`: 影響が及ぶ先 / 使っているもの（module 頁へのリンク）、テストと件数・実行コマンド（Go は `go test ./<dir>/...`、他は root の test script）、そこへ届く入口（flow seed・route・CLI・main）、直近 300 commit で一緒に変わったファイル（40 ファイル超の一括 commit と 1 回きりは除く、HEAD ごとに 1 回だけ `git log`）、注意（ハブ・1,500 行超のファイル・テスト無し・循環依存）。地図の部屋カードに「変更の手引き」リンク（`MapView.modules[].change`）。Reader で文書内の `.md` リンク（§6 の索引、module 頁どうし）が章に飛ぶようにした（以前は daemon に 404）。`doc-deep.test.ts`・`static-deep.test.ts`・`views-deep.test.ts` |
| 3 | 大きなコンポーネントの中身 | **済**（関数の体の区分けは JS/TS のみ） | 1,500 行超のファイルに領域の目次: トップレベルの並び（型・定数・関数・1 つの receiver のメソッド・ハンドラ）、400 行超の宣言はその中を行範囲付きで — JS/TS の関数（コンポーネント）は文の種類（状態の hook・副作用・計算値・ハンドラ・内部の関数・描画 JSX）、クラス・Rust の impl などはどの言語でもメンバー（フィールド＝状態・メソッド・`handle*`/`on*` ハンドラ）で。module 章 `m:<id>:regions` とコード画面（`FileContent.regions`、目次の上）。m3e の `app/Editor.tsx`（4,841 行）: トップ 12 区画 + Editor の中 12 区画（例 `454-757 状態（useState 53・useRef 33・useCallback 4）`、`3769-4840 描画（JSX）`）。`doc-deep.test.ts`・`views-deep.test.ts` |
| 4 | 再 open の安定（CR gen #8） | **済** | (a) `doc.index.json` の親モジュールの行はファイルを持たない（`reps: []`）ので、seed から開くたびに親が生まれ直していた（`internal` ⇄ `internal-2`、crit / excalidraw とも交互に）。親の seed は子の members の和集合で Jaccard 照合する。(b) **42 / 43 の本当の主因**: parse Worker の 250 ms は壁時計で、負荷のある機械では crit の `session.go`・`server.go`・`web/app.js` などがシンボル無しで索引されていた。4 並列の open で S5 497k〜519k、S8 42 / 43 / 44 task → 1 回だけ 8 s の予算でやり直す（`PARSE_POOL.parseRetryMs`）。text cache も再走査中に空にせず丸ごと入れ替える。(c) **残っていた揺れ**（3 並列で S5 445k / 517k）: 背景の persist が書き込みの後始末（メモリ上の skeleton を捨てる）を write slot の中で済ませていた。server の workspace writer は slot 全体を外側の transaction で包み、dev / test build は 50 ms を超えた slot を例外で巻き戻すので、負荷のある機械では行も消えメモリの写しも消え、そのファイルの skeleton が読めなくなっていた（module 文脈が小さくなる）。後始末を slot が確定した後へ移した（`robustness.int.test.ts`、修正前は fail）。修正後は 3 並列・4 並列でも計画が完全一致。`structure.test.ts`・`quality.corpus.test.ts`（crit / excalidraw、実 parse）・`test/int/reopen-corpus.test.ts`（実 daemon、新しい copy + 新しい home × 3、分割と complete 見積りの task 数・入力 token が一致。3 並列・4 並列でも pass）・`worker.test.ts`・`texts.int.test.ts` |
| 5 | flow seed（gen #4） | **済** | ハンドラの解決: 包まれた値（`s.withReady(s.handleX)`・`http.HandlerFunc(h)`・`wrap(list)`・`View.as_view()`・`h.bind(this)`）は内側から、factory（`s.serveIndexHTML()`）は最後に。import 先のハンドラ、`add_url_rule(view_func=)`・`add_api_route(path, fn)` も。seed: ハンドラ自身の呼び出しが最初の一歩を決め、呼ぶ先の「人気」（そのファイルを呼ぶハンドラの数）の平均で順位付け、health / version / 静的資産は最後、最初は 1 つの一歩先モジュールにつき 1 本。module walk で重複除去しない（同じハンドラだけ除く）。tooling・データだけのファイル・別言語へは歩かない。`facts.test.ts`・`flow.test.ts`（合成 router と crit） |
| 6 | 予算 | **測った**（下の §3。1.0 s の目標は負荷の下で未達、限度内） | `bench/open.bench.ts`（`idx.s04.cold.100kloc`: 新しい process・空の home・`.mitori/` なしの crit を開いて静的文書の適用まで、出荷と同じ release build）。予算の measure をこの case に向けた（`unmeasured` を外した） |

## 2. 計測（Apple M5 Max、他のセッションと同居。ロードアベレージは 10〜75 で大きく揺れた）

### route と flow seed（gen #4、`fixtures/truth` は route 数・precision / recall とも不変）

| repo | route（全 scope） | ハンドラ付き 前 → 後 | 備考 |
|---|---|---|---|
| crit | 62 | **44 → 61** | 残る 1 本は `http.FileServer`（標準ライブラリ、正しく未解決） |
| hono | 3 | 0 → 0 | 3 本ともインラインの arrow（runtime-tests） |
| flask | 21 | 20 → 20 | examples（scope example） |
| fastapi | 438 | 438 → 438 | docs_src（scope example） |

crit の seed（limit 8）— 前: `ANY /api/health`（line 136、最初の route）が 1 番、包まれたハンドラは全部同じ walk に潰れて 3 本、
CLI の walk は `web/embed.go > scripts/bench-compare.py` に入っていた。
後: `/api/comment/`・`/api/review-comment/`・`/api/events`（→ `internal/session/session.go`）、`/api/share/upsert-payload`（→ `share.go`）、
`/api/files/list`（→ `vcs/git.go`）、`/api/attachments`（→ `session/attachments.go`）、`crit share`、`cmd/crit`。どの walk も main scope・同じ言語のファイルだけ。

### outbound 事実（コーパス）

crit 178（`git` 41・`gh` 17・`sl` 16・`jj`・`glab` の子プロセス、Web UI の `/api/*` への fetch、net/http）、excalidraw 17（fetch・XHR・firebase・sentry）、
react 24、ripgrep 3、m3e 4、hono 5、flask / fastapi 0（examples の外に無い）。

### 時間

| 測ったもの | 値 |
|---|---|
| `staticGuide`（§4/§5 + 型 + 変更の手引き + 領域） | crit 19〜23 ms（型 1 ms、変更の手引き 11 ms、領域 6 ファイル）、m3e 4 ms、excalidraw 17〜21 ms、react 105〜112 ms（既存の読む順番が大半） |
| `applyStatic`（react の入力、warm） | 約 15 ms（以前は §11 の総当たりで約 28 ms。今回 §11 と TODO の照合を 1 パスにした） |
| crit の cold open（S0〜S4 + 静的文書）A/B（同じ負荷で base / head を交互に 5 回、median） | base 1,365 ms / head 1,424 ms（+4 %）。S1 +36 ms（outbound 検出）、S4 +19 ms（ハンドラの text）、静的文書 +16 ms。ロードアベレージ 15〜17 の下。`bench:compare`（3 pairs）は base 1,292 / head 1,439 ms で gate pass（+11 %、cv 0.09 / 0.12）。この後で seed の memo と precheck と §11 の高速化を入れた（§3 の再計測を参照） |

## 3. 再計測（最後の commit で）

`scripts/nd bun run bench:compare --base-root <main の export + bench ファイル> --id idx.s04.cold.100kloc --no-wait`（3 pairs、
ロードアベレージ約 20、18 コア）:

| | base（main） | head（`rem/doc`） | Δ | cv |
|---|---|---|---|---|
| crit cold open（S0〜S4 + 静的文書） | 1,189 ms | 1,177 ms | −1.1 %（gate pass） | 0.247 / 0.081 |

予算 1,000 ms（機械係数 1.13 で 1,130 ms）に対して 1,177 ms は **warn**（limit 2,260 ms の内側）。負荷の無い機械での値は測れていない。
head の追加分（outbound 検出・ハンドラの text・型 / 変更の手引き / 領域）は、§11 の 1 パス化・seed の memo・precheck で相殺した。

同じ回の最初の試行では、base（main）が dev build の slow-slot 検査（`doc.static` が 54 ms）で open ごと失敗した。bench は出荷物を
測るものなので child を release build にした（検査は dev / test build の開発用のもの。head の静的文書の組み立ては §11 の 1 パス化で react の入力でも約 10 ms）。

### 検証（最後の commit で）

`scripts/nd bun run check` 緑（tsc・biome・boundaries・cr-ledger・budgets・contract-index・svelte-check）。`scripts/nd bun test` 全体
2,813 pass / 0 fail（14 skip はコーパスや実エンジンが要るもの）、`bun run golden` 113 pass。`test/int/reopen-corpus.test.ts` は
3 並列・4 並列でも pass。

## 4. やっていないこと・残り

1. **履歴の無い clone では co-change が出ない**: `GitReader.log` は shallow clone で空を返す（platform の方針）。コーパスはすべて
   shallow なので「履歴を読めません」になる。履歴のある clone では出る（単体テストで確認、実 repo での見た目の確認はしていない）。
   直すなら platform が shallow でも読める範囲の commit を返す（地図の churn overlay も同じ理由で無い）。`cr-requests/doc.md` #4。
2. **gen は outbound 事実をまだ使わない**: module 文脈・repo pack には載せていない（pack 形式と prompt golden が変わる）。
   `cr-requests/doc.md` #1。
3. **関数の体の区分けは JS/TS だけ**: Go / Python の 400 行超の*関数*は中を区分けしない（トップレベルの並びは出る。クラス・impl はメンバーで出る）。
4. **「新しい Kind を足すには」の理解テストの再採点はしていない**（実エンジンが要る）。変更の手引きがその問いに答える材料
   （`lib/tokens.ts` の `KIND_SPEC`・`Kind` 型を使う module と、その tests、一緒に変わるファイル）を出すところまで。
5. **parse の再試行は最大 8 s**: 2 MB 以下（それ以上は読まない）のファイルが 250 ms を超えたときだけ。極端な負荷でも 8 s を超えれば
   今までどおり `parse_timeout` になり、そのときだけ揺れは残る。
6. **pin store にも同じ形の後始末がある**（担当外のため未修正）: `packages/indexer/src/pin/store.ts` の `saveRows` は
   `pending.delete` を write slot の中で行う。外側の transaction が巻き戻ると、dirty なファイルの text が DB にもメモリにも無くなる。
   persist と同じく `await write(...)` の後に移せば直る（`cr-requests/doc.md` #5）。
7. **dev / test build の 50 ms slot 検査は負荷で落ちる**: persist の 250 blob の chunk や main の `doc.static` は、ロードアベレージ 20 超で
   50 ms を超えることがある。今回の修正で「落ちても結果は変わらない」ようにしたが、落ちること自体は残る（test の時間ゆらぎの原因になりうる）。
8. **web は加算だけ**: コード画面の「このファイルの中身」と部屋カードの「変更の手引き」は既存の部品（`.outline`、`.btn-sec`）。
   見た目の調整は ux トラックへ（`cr-requests/doc.md` #3）。

