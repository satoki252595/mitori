# 残課題パス — doc トラック（2026-10-04、`rem/doc`）

コンセプトの「一度だけ省トークンで読む → 読める設計書 → 初見者が分かり、専門家が細部を詰める」のうち、
**0 トークンで出せる中身**と**同じ commit なら同じ結果**を詰めた。LLM 消費は **$0**（実エンジンは使っていない）。
契約の変更は `packages/core/CR-LEDGER.md` §8（CR rdoc-1〜7。5〜7 は敵対的検証パス、§5）、他トラックへの依頼は `docs/design/cr-requests/doc.md`。

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
   shallow なので「履歴を読めません」になる。履歴のある clone では出る（検証パスで実 repo でも確認: この repo を `.git` ごと複製して開くと
   289 commit の窓で意味のある行が出る。例 gen の prompts モジュール → `prompts.lock.json` 11 回）。
   直すなら platform が shallow でも読める範囲の commit を返す（地図の churn overlay も同じ理由で無い）。`cr-requests/doc.md` #4。
2. **gen は outbound 事実をまだ使わない**: module 文脈・repo pack には載せていない（pack 形式と prompt golden が変わる）。
   `cr-requests/doc.md` #1。
3. **関数の体の区分けは JS/TS だけ** → 検証パスで一部解消: Go / Python の 400 行超の関数は、ブロックの先頭コメントが 3 つ以上あればそれで区切る
   （コメントの無い長い関数は今も 1 行）。
4. **「新しい Kind を足すには」の理解テストの再採点はしていない**（実エンジンが要る）。変更の手引きがその問いに答える材料
   （`lib/tokens.ts` の `KIND_SPEC`・`Kind` 型を使う module と、その tests、一緒に変わるファイル）を出すところまで。検証パスで §7 に `Kind`
   （8 ファイル）が出るようになり、変更の手引きに「よく使われる宣言」（`Item` 15・`Kind` 8 …）、`lib/tokens.ts` の目次に `KIND_SPEC`（924-1580）。
5. **parse の再試行は最大 8 s**: 2 MB 以下（それ以上は読まない）のファイルが 250 ms を超えたときだけ。極端な負荷でも 8 s を超えれば
   今までどおり `parse_timeout` になり、そのときだけ揺れは残る。
6. **pin store にも同じ形の後始末がある**（担当外のため未修正）: `packages/indexer/src/pin/store.ts` の `saveRows` は
   `pending.delete` を write slot の中で行う。外側の transaction が巻き戻ると、dirty なファイルの text が DB にもメモリにも無くなる。
   persist と同じく `await write(...)` の後に移せば直る（`cr-requests/doc.md` #5）。
7. **dev / test build の 50 ms slot 検査は負荷で落ちる**: persist の 250 blob の chunk や main の `doc.static` は、ロードアベレージ 20 超で
   50 ms を超えることがある。今回の修正で「落ちても結果は変わらない」ようにしたが、落ちること自体は残る（test の時間ゆらぎの原因になりうる）。
8. **web は加算だけ**: コード画面の「このファイルの中身」と部屋カードの「変更の手引き」は既存の部品（`.outline`、`.btn-sec`）。
   見た目の調整は ux トラックへ（`cr-requests/doc.md` #3）。

## 5. 敵対的検証パス（2026-10-04、同じ `rem/doc` に 8 commit、`c8bcf08..`）

実装者の受け入れ確認をすべてやり直し、`git diff main...HEAD` を読み、crit・m3e-canvas・excalidraw（と hono・flask・fastapi・react）を
本物の daemon で開いて出力を確かめた。LLM 消費は **$0**。契約の変更は CR rdoc-5〜7（`packages/core/CR-LEDGER.md` §8）。

### 見つけた問題と直したこと

| # | 見つけたこと（実 corpus での症状） | 直したこと · 回帰テスト |
|---|---|---|
| 1 | §7「使うファイル」が型の**ファイル**を import する数だった。crit の `session.go` の型は全部 42、m3e の `tokens.ts` の型は全部 33、excalidraw は 181 / 186。順位も型ごとに区別できず、m3e の `Kind`（「Kind を足すには」の型）が表に出なかった | indexer `symbolUsers`（CR rdoc-5、`pack/usage.ts`）: S1 の参照と解決済み import から型を使うファイルを数える（Go は `pkg.T` と同じパッケージ）。m3e は `Kind` 8・`Doc` 8・`Item` 15（grep と一致）、crit は `CritJSON` 31・`Comment` 17。コールバックのフィールド（`onChange: (…) => void`）は「持っている型」に数えない。`usage.test.ts`・`doc-deep.test.ts` |
| 2 | §8 の表は 30 行で黙って切れ、HTTP が先頭だったので、crit の Web UI の `/api/*` への fetch 25 行が `glab` 子プロセスを押し出していた。行の比較関数も `via` が同じだと両向きに 1 を返していた | 相対パスへの呼び出し（自分のサーバーの API）を外部の相手の後に、切った行は表の下に「ほか n 行（m か所）」、比較を全順序に。`static-deep.test.ts` |
| 3 | 変更の手引きの実行コマンド: JS のテストしか無い crit `web/style-live` に `go test ./web/...`（`embed.go` が 1 つあるだけ）、他の package から付いたテストで `go test ./...`、テストが無いのに「実行」 | テストの言語で決める。Go はその module 自身のパッケージだけ（`go test ./internal/vcs`、4 つ以上は共通の親 `/...`）、他は repo の test コマンド、テストが無ければ出さない。`doc-deep.test.ts` |
| 4 | 1,500 行超の目次が作者の区切りを無視していた: crit `web/app.js`（11,055 行）は「関数（152）」が 4,500 行、作者は 72 個の見出し（Comment Form・SSE Client・Story mode…）を書いている。m3e `Editor` の中にも 13 個（document・history・pointer: parts…）。excalidraw の `App` クラスは矢印関数のフィールド（ハンドラ）が「状態（22）」 | CR rdoc-6: 見出しコメント（1 行・`#region`・`MARK:`・罫線で囲む形）が 3 つ以上・平均 600 行以内なら、それを領域にする（`pointer: parts — 状態 10・内部の関数 8・副作用 6（useEffect 6・…）`）。区切りの中の大きな宣言はその名前の行の後に中身。Go / Python の長い関数はブロックの先頭コメントで。関数を値に持つフィールドはメソッド / ハンドラ。体の上限は 300 行ごとに 1（12〜24）。見出しは Markdown に入れる前にエスケープ。`doc-deep.test.ts`（crit / m3e / excalidraw の形をそれぞれ再現） |
| 5 | §8 に excalidraw の共同編集の socket と Firestore が無かった（`await import(/* webpackChunkName */ "socket.io-client")` のコメントで束縛が取れない、firebase の `getFirestore(` を数えない） | socket.io-client・`firebase/firestore`（DB）・`firebase/storage`・ヒントコメント付きの動的 import。`facts.test.ts` |
| 6 | gen #4 (a) が手付かず: m3e（Next.js）と excalidraw（Vite）は flow seed 0、読む順番に「入口」も無かった | `route.next-app@1` / `route.next-pages@1`（indexer spec §5.2 の定義どおり）と `entry.web@1`（`index.html` の module script）。m3e `GET / → app/page.tsx#Page`、excalidraw `excalidraw-app/index.tsx → i18n → App.tsx`。mixed fixture の next-app の truth 5 本を採点対象に。`facts.test.ts`・`worker.test.ts` |
| 7 | **本番だけの不具合**: `.sql` は generic の source なので parse Worker が検出器を 1 つも走らせず、`schema.sql@1` は daemon では一度も動いていなかった（go-small の `migrations/0001_init.up.sql` の books / tags / book_tags が §7 に出ない。test の pipeline は全検出器を走らせるので隠れていた） | Worker: grammar の無い source ファイルでも、当てはまる text 専用の検出器を走らせる（CR rdoc-7、`parse/worker.ts` 5 行）。INT-04 / 05 の fake engine に §7 データモデルの返答を足した（計画に s7 が入るため）。`worker.test.ts` |
| 8 | 変更の手引きは「誰が使うか」は言うが「何を使うか」を言わなかった | 「よく使われる宣言（変えると波及する）」: module の export 宣言のうち他のファイルが多く使うもの（2 ファイル以上・5 件、同名は 1 行）。m3e `lib (tokens, tidy)` → `Palette` 26・`Item` 15・`Frame` 13・`Group` 9・`Kind` 8 |
| 9 | flow seed がルートごとに router ファイル（crit `server.go` 3,500 行）を split していた | 1 回の呼び出しで 1 回だけ。crit の `flowSeeds` 9〜15 → 6〜9 ms |

### 受け入れ確認のやり直し

| 確認 | 結果 |
|---|---|
| `scripts/nd bun run check` | 緑（tsc・biome・boundaries・cr-ledger・budgets・contract-index・svelte-check） |
| `scripts/nd bun test`（全体、ロードアベレージ 15〜50） | 1 回目 2,827 pass / 3 fail: INT-04 / INT-05 は #7 の修正で計画に s7 が入ったための fake engine の不足 → 直した。最終 commit で 2 回目 **2,830 pass / 2 fail**、どちらも時間の予算: SKEL-AT-02 の ELK ≤ 120 ms（272 ms。実装者の `c8bcf08` でも単独で 136 ms で fail）と INT-03 の dev build の slot 検査（`doc.static` 55 ms > 50 ms、crit の open が 1,735 ms かかった負荷の回。単独では pass、§4-7 の既知の揺れ）。静的文書の適用は crit で warm 4.5 ms（`c8bcf08` 4.5 ms）、新しい store へ cold 4.3 ms（3.5 ms）で、この pass の追加は 1 ms 未満 |
| `bun run golden` | 113 pass |
| `test/int/reopen-corpus.test.ts`（crit / excalidraw、新しい copy + home × 3） | 単独でも **3 並列**でも pass（分割と complete 見積りの task 数・入力 token が一致） |
| route 数（全 scope） | crit 62（ハンドラ 61）・hono 3・flask 21・fastapi 438 は不変。react / excalidraw の Next の例（examples）は example scope で main に出ない |
| 変更の手引きの co-change | 履歴のある repo（この repo の複製、289 commit）で意味のある行が出る。shallow な corpus では「履歴を読めません」（platform の CR #4） |
| `staticGuide`（§4 / §5 + 型 + 変更の手引き + 領域） | crit 9 ms・excalidraw 19 ms・react 89 ms（中央値、負荷の下）。うち `keyTypes`（`symbolUsers` 込み）crit 3 ms・react 13 ms |
| crit cold open（S0〜S4 + 静的文書） | `bench:compare --id idx.s04.cold.100kloc --pairs 5`（base = main の export + bench の 2 ファイル、release build）: base 2,286 ms / head 2,329 ms（**+1.9 %、gate pass**、cv 0.17 / 0.11）。ロードアベレージ 37〜50 の下（機械係数 2.98）なので絶対値に意味は無い。途中の commit（`6a38398`）で測った絶対値はロードアベレージ約 13 で中央値 1,044 ms（p95 1,159 ms）。1.0 s の目標は静かな機械での確認が残る |

