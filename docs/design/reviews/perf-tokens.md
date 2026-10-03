# 設計レビュー — 性能と token 効率（adversarial critic）

- 版: 1.0（2026-10-03） / 対象: `ARCHITECTURE.md`、`adr/*`、`specs/{generation,indexer,loop,ux,testing}.md`、`contracts/*`、`MILESTONES.md`、`prototypes/JUDGEMENT.md`
- 観点: SLO は指定の算法で達成できるか（hot path、O(n²) の罠、メモリ、Worker、SSE 量、UI 描画）、prompt・bundle・system prompt の token の無駄、cache の正しさ（prefix の安定）、見積りの精度、並列が cache 書き込みに与える影響
- 表記: **[実測]** = 本レビューでこの Mac（Claude Code 2.1.288）で測った値。**[既存データ]** = 研究・design 時の録画（`scratchpad/*.json`）を集計し直した値。**[推定]** = 式による推定（式を併記）
- 本レビューの実測費用: `claude -p` を 8 回（sonnet 6・haiku 2）、API 換算 合計 ≈ $0.03。記録は `scratchpad/design-tmp/perf-review/`（`r_*.json`、`r_long2.ndjson`、`warm.py`、`est3.py`）

---

## 0. 要約（重大度順）

| ID | 重大度 | 一言 | 主な場所 |
|---|---|---|---|
| PT-01 | high | SSE の「type ごとの latest-wins coalescing」が `job.event` の text delta・phase・result、別 entity の `gen.task`・別節の `doc.block.partial` を捨てる | `contracts/api.ts` `SseEventMeta.throttleMs` / `SSE_EVENT_META`、testing SRV-I-016 |
| PT-02 | high | claude-cli（サブスク）は入力の**全部**（system + tail）を 1h cache に 2× で書く。τ=1 は既存録画で確定済みで、その場合 cost SLO を超える。`CLAUDE_CODE_PROMPT_CACHE_TTL=5m` で 1.25× にできる（実測） | gen §9.2–9.3・§16 M-3・§17.5-1、`GEN_ESTIMATE_PARAMS.tailCacheWriteShare`、loop §6.4 |
| PT-03 | high | `gen.block/1` の JSON 足場が出力 token の **69%**（spec 自身の §6.8 の例で実測）。spec は 35% を前提に `target_chars` と O を決めている → 出力・時間を 1.5〜1.7 倍過小見積り | gen §5.6.1 `target_chars`、§6.2 full form、§6.8、§9.2 `O_t` |
| PT-04 | high | interactive 用の slot 予約が無い。生成中（background が 3 slot）に Explain/Fix が S5 1 本分（20〜40 s）待たされる | ARCHITECTURE §2.6、loop §6.8、`contracts/loop.ts` `AgentScheduler` |
| PT-05 | high | repo pack の見出し行に `digest=`・`files=`・`loc=` が入り、gen run は pack/snapshot を固定しない → 実行中のコード編集 1 回ごとに共有 prefix（≈12k）が割れて書き直し | indexer §7.4・§2.2 `packKey`、gen §3.8・§5.4 |
| PT-06 | high | 正本の ARCHITECTURE §7.5 と MILESTONES WP-06 は gen に `UNTRUSTED_FENCE`（呼び出しごとの乱数 nonce）を指示。gen spec の `GEN_DATA_FENCE` と矛盾し、正本どおりに作ると唯一の cache 点が毎回壊れる | ARCHITECTURE §7.5、MILESTONES WP-06、gen §5.1-4 |
| PT-07 | high | block HTML の cache key `hash × lang × rendererVersion` は `render()` の入力（claims の cite 行番号・verdict、glossary）を含まない → 再アンカー後に古い出典チップ・peek 範囲・バッジを配る | `contracts/gen.ts` `BlockRenderer`、`api.ts` `BlockView`、ARCHITECTURE §5.3 `doc_html` |
| PT-08 | medium | S5 の DEPS に「先に終わった依存 module の生成要約」を入れ、それが cacheKey に入る → key が dispatch のタイミング依存。AC-28（2 回目は全 cached）と AC-22（session と cli のバイト一致）が両立しない | gen §3.3・§3.8・§8.4.1-2、AC-22/28 |
| PT-09 | medium | claude-cli には出力上限 flag が無い。`CLAUDE_CODE_MAX_OUTPUT_TOKENS` を使うと、上限に達した時点で CLI が**黙って 3 回続きを要求**し（API 呼び出し 4 回・出力 4 倍）、`is_error` で終わる（実測）。spec の `stop=max_tokens` 経路は設計どおりには発火しない | gen §5.3 max out、§6.4-1(c)、§3.6-5、loop §6.5.2 |
| PT-10 | medium | session engine（大きな生成の第一級経路）は、task ごとの新しい subagent が 12k の `system.md` と入力を cache 共有なしで読み直す。subagent の基礎 context と Read の行番号も上乗せされる。見積りは claude-cli の式のまま | gen §8.4.2 README、§9.3「session」、§9.5 |
| PT-11 | medium | `doc.index.json` が 1 枚岩で、500 ms ごとの flush で全体を canonical serialize する。cite の blob や行番号は保存のたびに変わる → O(文書サイズ) の仕事が single writer の中で繰り返され、50 ms の stale バッジ経路と競合する。commit 時の diff ノイズや衝突も出る | gen §10.8–10.9・§11.2-1、`core.ts` `DocIndex`、ADR-0004 |
| PT-12 | medium | anchor の S2（snippet 照合）は先頭行で候補を絞り、候補ごとに n 行の窓 hash を計算する。`}`・空行が全行の 17%・10%（crit で実測）なので、1 anchor あたり数百〜千の候補になる。`anchor.batch1k` 50 ms は最悪の場合に守れない | loop §1.3 S2、§0.3 `anchor.batch1k` |
| PT-13 | medium | 常駐する claude プロセスは 1 本 ≈ 204 MB RSS（実測）。warm ≤ 3・parked ≤ 3・実行中 3・gen keepAlive（数に入らない）で最大 ≈ 2 GB。子プロセスの RSS 予算が無い。warm で隠せる時間は ≈ 1.1 s（実測） | loop §6.6.1–6.6.2、ARCHITECTURE §2.3（idle RSS） |
| PT-14 | medium | idle RSS 30 MB / indexer idle 寄与 0〜5 MB は、main thread がメモリ上の snapshot（名前索引・palette・graph）を持ち、700 MB peak の S2〜S4 を main thread で回す設計とは両立しない | ARCHITECTURE §2.3・§10.2、indexer §0.3・§1.1・§11.3 `idx.rss.idle` |
| PT-15 | medium | palette の ETag が workspace の `rev`（書き込みのたびに進む）→ 5 万件の索引が書き込みのたびに再取得される。`GET /doc` は全 `BlockMeta` を返す（10k block ≈ 5 MB）ので、`doc.outline` のたびに全量を取り直す | ARCHITECTURE §4.2、ux §4.10・§12.3、`api.ts` `DocOutline` |
| PT-16 | low | Shiki を窓（±8 行・200 行塊）単位で描くと、複数行の構文（block comment・template literal・docstring）を誤って色付けする。compute Worker を必要時に起動するので、最初の hover で Shiki の初期化コストを払う | ARCHITECTURE §2.4・§4.2、ux §4.3.6・§12.8 |
| PT-17 | low | `read()` / L1 / peek / accept が `git cat-file` を 1 回ずつ spawn する（batch process の規定が無い） | indexer §7.7、loop §7.8-8 |
| PT-18 | low | warm-first が「1 本目の最初の **text** delta」まで後続を止める（thinking の分だけ遅い）。1 本目が token を出さずに失敗したときに後続を解放する規則が無い | gen §3.5・AC-04、`loop.ts` `fanoutKey` |
| PT-19 | low | patch job が毎回 worktree を全体 checkout する。全体を要る gate（typecheck・test）が無い・未信頼でも同じ。20k files 級では job ごとに数百 MB を書き、最大 8 本を保持する | loop §7.3・§7.11、§8.2 |
| PT-20 | low | bundle の固定行（header・DENY・ACCEPT ≈ 70 token）が tail（2× で cache 書き込み）に毎回入る。cache read（0.1×）になる system prompt file に移せる | loop §4.1–4.3・§6.9 |

PT-02 と PT-03 を直した場合の 100k LOC standard（式は gen §9 の `est2.py` を拡張した `perf-review/est3.py`）[推定]:

| 前提 | API 換算 $ | 出力 | C=3 の時間 |
|---|---:|---:|---:|
| spec のまま（1h、O は spec の値） | 2.92 | 75k | 5.2 分 |
| 1h + 実測の足場比率（S5 ×1.68、節 ×1.4） | **3.34** | **116k** | **7.2 分** |
| 5m TTL（PT-02）+ 実測の足場比率 | 2.57 | 116k | 7.2 分 |
| 5m TTL + compact 行（PT-03） | **2.26** | 85k | 5.7 分 |

naive map-reduce（≈ $10.8、gen §9.6）との比は 0.31 → 0.21 になり、目標 0.25 の内側に入る。

---

## PT-01 [high] SSE の coalescing がデータを捨てる

**場所**: `contracts/api.ts` `SseEventMeta.throttleMs`（「Coalescing window; latest value wins」）と `SSE_EVENT_META`。testing §4.5 SRV-I-016（「`throttleMs` で最新値のみ」を合格条件にしている）。ARCHITECTURE §3.4。

**問題**: coalescing の key が event の **type だけ**で、「最新値で上書き」と定義されている。次の type では、これがデータの欠落になる。

- `job.event`（100 ms）: `JobEvent` の `t:"text"` は**差分**（`delta`、core.ts）。上書きすると 100 ms 内の delta が 1 つを残して消え、Explain の streaming 表示が欠ける。同じ type に `phase`・`tool`・`usage`・`result`・`window` も乗っている。phase の直後 100 ms 以内に text が来れば phase が消え、ジョブカードの実ステージ表示（ux §6.4、loop §8.6）が飛ぶ。`replay: false` なので後から取り戻せない。
- `gen.task`（100 ms、`replay: true`）: C=3 では 3 本の task が同時に状態を変える。別の task の更新で上書きされると、その task は最後の状態を受け取れず、resync まで「実行中」のまま残る。
- `doc.block.partial`（100 ms）: 3 つの節が同時に生成中のとき、どれか 1 節の partial しか届かない。他の節の caret は止まり、flicker する。
- `workspace.updated`（250 ms、scope global）: 複数 workspace の summary が互いを上書きする。
- `doc.saved`（500 ms）: `files` の和集合が失われる（影響は S8 だけ）。

**修正**:
1. `SseEventMeta` を `{ replay, coalesce?: { windowMs, key: "type" | "entity", merge: "latest" | "concat-text" | "none" } }` に変える。
   - `job.event`: key = `job`。`text` は同じ window 内の delta を**連結**して 1 個にする（`concat-text`）。`phase`・`tool`・`result`・`usage(final)`・`window` は coalesce しない（そのまま送るか、`events: JobEvent[]` の配列にまとめる）。
   - `gen.task`: key = `task.id`、latest。`doc.block.partial`: key = `section`、latest（payload が累積 text なので latest で正しい）。`workspace.updated`: key = `summary.key`。`doc.saved`: files の和集合。
2. SRV-I-016 を「同じ entity は最新値・別 entity は独立・text は連結・終端 event は必ず届く」に直す。fuzz 試験として、3 job × 200 delta を 1 ms 間隔で流し、client 側で再構成した text が原文とバイト一致することを確かめる。

---

## PT-02 [high] claude-cli は全入力を 1h cache に 2× で書く（τ=1 は確定済み）→ `CLAUDE_CODE_PROMPT_CACHE_TTL=5m`

**場所**: gen §9.2（`τ_g` [仮]）、§9.3、§9.6 の「τ=1 / τ=0」2 列、§16 M-3、§17.5-1。`gen.ts` `GEN_ESTIMATE_PARAMS.tailCacheWriteShare`。loop §6.4 `ENV_ALLOWLIST`。ARCHITECTURE §4.1（「1h TTL 書き込みは 2 倍」）。

**根拠**:
- [既存データ] 研究・design 時の `claude -p` 録画 40 本（`scratchpad/*.json`）を集計し直した。サブスク経由の Sonnet/Opus/Haiku では、全 run で `input_tokens` = 2〜26、`cache_creation_input_tokens` ≈ 入力のほぼ全部、`ephemeral_1h_input_tokens` = `cache_creation_input_tokens`、`ephemeral_5m` = 0 だった。たとえば `par_1`: in 2 / cw 1,716（1h 1,716）/ cr 0。**τ=1 で、しかも TTL は 1h** であることは測り直すまでもなく確定している（M-3 の (a) は不要）。
- [実測] CLI のバイナリに、prompt cache の TTL を選ぶ env がある: `CLAUDE_CODE_PROMPT_CACHE_TTL`（"5m" または "1h"。未設定なら「サブスクで枠内なら 1 時間、API key 等なら 5 分」。文言は「1-hour cache writes are billed at a higher rate」）。`--setting-sources ""` のまま `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` を付けて実行すると、`cache_creation.ephemeral_5m_input_tokens = 878`・`ephemeral_1h = 0`・`total_cost_usd = 0.002239`（= 878 × $2.5/M + 出力）になった。同じ条件で env を付けない run は 1h（1,081 × $4/M）だった。
- spec 自身の §9.6 でも、τ=1 では 100k LOC standard が $2.92、naive map-reduce 比 0.27 で、目標 0.25 を超える（§9.6 の注記）。

**影響**: tail（S5 の入力 ≈ 14k）は 1 回しか使わないのに、毎回 2× で書かれる。1h TTL が得をするのは、同じ prefix を 5 分以上空けて読む場合だけである。gen の run は C=3 で連続して dispatch するので、読むたびに 5 分の TTL が延びる（cache read で更新される）。on-demand の `doc.*` は repo pack を持たない（gen §5.5）。Explain/patch は 1 回きりの呼び出しである。つまり 1h の利点はほとんど無く、書き込み単価だけが 2× / 1.25× = 1.6 倍になっている。

**修正**:
1. loop §6.4 に「mitori が**設定する** env」（`ENV_INJECT`）を追加する。`ENV_ALLOWLIST ∩ 親 env` とは別枠で、mode ごとに決める: generate・answer・findings・patch（初回）= `CLAUDE_CODE_PROMPT_CACHE_TTL=5m`。`persistSessions = true` の thread のように後で続きが来るものだけ `1h`。warm pool の profile key（loop §6.6.1）には、この env の**値**も入れる（いまは key の集合だけ）。
2. `GEN_ESTIMATE_PARAMS` を `tailCacheWriteShare: {"claude-cli": 1.0}`（[仮] を外す）と `cliCacheTtl: "5m"` にし、§9.3 の `p_w1` を `p_w(ttl)` にする。§9.6 の τ=0 列は消す。
3. 契約テストに CC-24 を追加する: env 付きの lean 実行で `ephemeral_5m > 0` かつ `ephemeral_1h = 0` になること（env 名や意味が変わったら検知する）。M-3 は「(b) 6 分空けると miss になること、(c) yield で 5 分を超えて止めた後に 1 回だけ書き直すこと」の確認に縮める。
4. 効果 [推定、est3.py]: 100k standard は $2.92 → $2.26（PT-03 と合わせた場合）。Explain・Fix も入力の書き込み単価が 37.5% 下がる（patch 2.5k 入力で約 −$0.004）。サブスクの 5h 枠の消費もおそらく同じ比率で減る（M-8 の κ で確かめる）。

---

## PT-03 [high] 出力の 69% が JSON の足場（spec の前提は 35%）

**場所**: gen §5.6.1（`target_chars = round100(O × (ja ? 0.8 : 1.9))`、「md 以外の JSON が出力の約 35%」）、§6.2（full form では `aspect`・`kind`・`depth`・`audience` が必須で、`section` も書かせている）、§6.8 の例、§9.2 `O_t`、§5.3 の max out。

**根拠 [実測]**: spec §6.8 の 5 行（block 3・module 1・end 1）を、Sonnet 5.5 の tokenizer で差分法（baseline 495 token）で数えた。

| 形 | token | md（本文）の割合 |
|---|---:|---:|
| §6.8 の full form そのまま | **586** | 179 / 586 = **31%** |
| md・name・summary だけ | 179 | — |
| compact（下記。`section`・`kind`・`depth`・`audience` を省き、claim は文字列） | **383** | 47% |

足場は 1 block あたり約 136 token（claim 込み）。prompt は「md を `target_chars` 字書け」と指示するので、モデルは md 0.64·O token + block 数 × 136 + term・question 行を出す。S5 の典型（O ≈ 1,740、≈ 9 block）では実出力 ≈ 2,900 token で、O の約 1.7 倍になる [推定]。

**影響**: 出力は Sonnet で $10/MTok（入力の 5 倍）で、生成時間は出力で決まる（gen §9.5、`v = 125 tok/s`）。100k standard では出力が 75k → ≈116k、C=3 の時間が 5.2 分 → 7.2 分（est3.py）。見積りの初回 ±25%（AC-24）は出力側で外れる。S5 の max out 6,000 は、大きい module（O = 3,500）では 1.7 倍の ≈ 6,000 に thinking を足すと超え、PT-09 の自動継続に入る。`gen.labels` は 80 module × module 行 ≈ 50 token = 4,000 で、max out 4,000 ちょうど。最初に見える文字の遅れ: md は行の 50 token 後ろに来るので、partial 表示（§3.6-2）も ≈ 0.4 s 遅れる。

**修正**:
1. **メタはサーバが導く**: aspect の表（§4.2、§5.6 の各 prompt の規定）から kind・depth・audience は決まる。LLM に書かせるのは `t`・`id`・`aspect`・`md`・`claims`（と、aspect が複数の kind を許す場合だけ `kind`）。`section` は task が固定しているので書かせない（flows の `s3/<key>` だけは `flow` 行の後の順序で決まる）。validator は「省略 = 既定」とし、書かれていれば V07/V08 で検査する（後方互換）。
2. **claim を文字列にする**: `"claims":{"1":"behavior internal/session/store.go:40-58","2":"architecture"}`（kind + 空白 + `path:start-end` を最大 4 個 `,` 区切り）。answer/1 の `[[path:a-b]]` と同じ書き方なので、モデルは慣れている。parser は path の最後の `:` で分ける（answer と同じ規則）。
3. `target_chars` と O の式を分ける: `O_t = mdTokens(target_chars) + nBlocks·σ_block + nClaims·σ_claim + 行数·σ_line`。初期値は本実測から σ_block ≈ 70（compact）/ 136（full）にする。M-10 の事前値も 35% ではなくこの値にする。
4. M-1 の比較に「full form と compact form の妥当行率」を足す（compact で `gen.line.valid1` が 2 ポイント以上落ちたら kind だけ戻す、という判断規則にする）。`gen.labels` は 40 module / call にするか、max out を 6,000 にする。

---

## PT-04 [high] 生成中は interactive が slot を取れない

**場所**: ARCHITECTURE §2.6（レーンは優先順だけ）、loop §6.8（「並列数は turn が進行中の engine プロセスの数」）、`contracts/loop.ts` `AgentScheduler`（予約・preempt の規定なし）、loop §8.1（answer の slot 取得 ≤ 50 ms）。

**問題**: レーンは「待ち行列の順番」でしかない。初回生成は既定 C=3 の全 slot を background で埋める（gen §3.5）。S5 の task は 1 本 20〜40 s かかる（est3.py の d_t）。このあいだに Explain（`e`）や Fix（`f`）を押すと、どれか 1 本が終わるまで slot が空かない。最悪で 20〜40 s、平均でも ≈ 10 s 待つ。`agent.firstPhase`（warm 300 ms / cold 3 s）、Explain の完了 ≤ 8 s、synthesis §8.1 のデモ台本（生成が流れ込んでいる最中に文を選んで `f`）を満たせない。parked プロセスの repair（`continueSession` も slot を取る）も同じように待つ。warm pool の 1.1 s の短縮（PT-13）は、この待ちに比べれば誤差になる。

**修正**:
1. `SchedulerSettings.reserveInteractive = 1`（既定）: background は `C − reserveInteractive` 本までしか使えない（C=3 なら 2 本）。`doc` lane は残りを使ってよい。interactive が来ないときに background が予約分を使うことは**しない**（取り返す手段＝preempt が無いため）。
2. 代わりに `interactiveBurst = 1` を用意する: interactive は C を 1 本まで超えてよい（研究 06: 8 並列で 429 は出なかった）。429 を観測したら burst を 0 に落とす。
3. gen の makespan 見積り（§9.5）を、background の実効並列 `C_bg = C − reserve` で計算する（100k standard の C=3 は実質 C=2 になり、時間が伸びる。UI の「C=3」表示は `C_bg` を明記する）。
4. VirtualScheduler の試験に、background 3 本の実行中に interactive を 1 本投げ、≤ 50 ms で slot を取る（turn を開始する）ことを加える。

---

## PT-05 [high] repo pack が保存のたびに変わり、gen run が pack を固定しない

**場所**: indexer §7.4（見出し `=== mitori.repopack/1 repo=crit digest=3f9a… files=287 loc=72614 langs=…`）、§2.2 `packKey = xxh3(indexDigest + …)`、gen §5.4（system prompt = テンプレート + pack）、§3.8、§11.3（S9 の regen は gen.system を使う）、§12。

**問題**:
- pack の 1 行目に `digest=`（indexDigest）・`files=`・`loc=` がある。included ファイルが 1 行でも変われば、pack のバイト（＝system prompt、＝cache prefix の先頭近く）が変わる。MAP や ROUTES に変化が無い body だけの編集でも変わる。
- gen run は task ごとに入力を描く（`BlockMeta.gen.indexDigest` は「task 入力の snapshot」）。run の pack や snapshot を固定する規定が無い。生成は約 5〜7 分かかり、その間もユーザーはコードを書く（watcher → `indexer.update` → 新しい digest）。編集のあとに dispatch される task は新しい pack を作り、P ≈ 12k を書き直す。autosave で数秒ごとに保存されれば、ほぼ全 task が書き込み側になる: +12k × 2× × 37 task ≈ 0.9M token 相当、≈ +$1.8 / run（1h の場合）[推定]。
- S9 の regen（R1/R2/R4〜R8）と lazy module の生成は、定義上コード変更の後に走る。なので必ず新しい pack になり、毎回書き直す。

**修正**:
1. pack の本文から変わりやすい値（digest・files・loc）を外す（manifest と `RepoPack.meta` に置く）。言語構成のように粗い値だけを残し、丸めて入れる（loc は 10k 単位など）。
2. `GenRun.packKey` と `GenRun.systemPromptFile` を run の開始時に固定し、全 task で同じファイルを使う。task の module DATA（行番号付き skeleton・body）は dispatch 時の snapshot で描く。pack の FACTS にある `path:line` を引用したときは、pack を作った snapshot の blob で刻印し、その後は anchor engine で現在へ写す（moved cite と同じ経路）。
3. pack の「再利用許容」規則を足す: 新しい pack と run 固定の pack で MODULES・ENTRY・ROUTES・CLI・ENV・SCHEMA の**行集合**が同じなら（MAP の signature 差は許す）、on-demand・S9 でも古い pack を使い続ける。
4. 試験: (a) golden: 同じ run の全 task の system prompt file の xxh3 が group 内で 1 つだけであること。(b) cassette / live（CC-19 の拡張）: run の 2 本目以降の task で `cache_read_input_tokens ≥ 0.9 × P`。(c) 生成の途中で fixture のファイルを 5 回書き換えても (a)(b) が成り立つこと。

---

## PT-06 [high] 正本が gen に「呼び出しごとの乱数 nonce」を指示している

**場所**: ARCHITECTURE §7.5（「呼び出しごとの乱数 nonce 付き fence（`UNTRUSTED_FENCE`）で囲む」。gen の例外が書かれていない）、MILESTONES WP-06 の成果物（「gen prompt 群（英語・版固定・`UNTRUSTED_FENCE`）」）。これに対して gen §5.1-4 と loop §4.5 は「gen は `GEN_DATA_FENCE`（salt 付きの内容導出 nonce）」とする。

**問題**: ARCHITECTURE は自らを正本とし、spec はそれに従うと定めている（§0 前文）。WP-06 の担当者が MILESTONES と正本に従うと、gen の system prompt（repo pack を fence の中に置く）が呼び出しごとに変わる。claude-cli で唯一の cross-process cache 点が全 task で miss になる: 37 task × 12k × 2× ≈ +0.9M token 相当、≈ +$1.5〜1.8 / 100k run [推定]。CC-19（同じ要求を 2 回送る）では、この誤りを検出できない。

**修正**: ARCHITECTURE §7.5 に「gen は `GEN_DATA_FENCE`（内容 + workspace salt から導く nonce。system prompt に data を入れるため）、loop の bundle は `UNTRUSTED_FENCE`（乱数）」と 1 行足す。MILESTONES WP-06 の該当語を `GEN_DATA_FENCE` に直す。PT-05 の試験 (a)(b) を WP-06 の受け入れ基準に入れる。

---

## PT-07 [high] block HTML の cache key が入力を全部含んでいない

**場所**: `contracts/gen.ts` `BlockRenderer.render(block, claims, {lang, glossaryTerms})` と、そのコメント「cached by `hash × lang × rendererVersion`」。`api.ts` `BlockView`（「HTML is cached by `hash × lang × rendererVer`」）。ARCHITECTURE §5.3 `doc_html(hash × lang × renderer_ver)`。gen §10.3（`hash` は semantic hash = marker form。**行番号が変わっても変わらない**ように定義されている）。gen §11.2-1（moved cite は「link を書き換え、semantic hash は不変」）。

**問題**: HTML には、cite chip の label（`store.go:40-58`）・href・`data-*`（peek の範囲）・`.mc[data-verdict]`（バッジ）・glossary の `abbr.mterm` が入る。これらは `claims` と `glossaryTerms` から決まるが、key は `block.hash` だけを見る。S9 の静的マーキング（行がずれた cite）では、semantic hash が変わらないことが**設計上保証**されている。したがって cache は必ず hit し、**古い行番号の出典チップ**を配り続ける。新しく開いたタブ、resync、節の取得（`GET /doc/sections/:id`）で起きる。`doc.claims` の SSE による属性書き換えは、接続中のタブにしか効かない。verdict の変化（L3、human-verified）や、新しい用語の下線も同じ。信頼の表示（D-2）が誤った値になる。

**修正**（どちらか）:
- (a) key = `xxh3(block.hash ‖ claimsRenderDigest ‖ glossaryDigest(block に出る語) ‖ lang ‖ rendererVersion)`。`claimsRenderDigest` = 各 claim の `(id, verdict, cites[(path, start, end)])` の正規化 JSON の xxh3。
- (b) 2 段にする: 本文 HTML（marker を `<span class="mc" data-claim="cl_…">` の placeholder のまま描く）を semantic hash で cache する。chip と verdict は、配信時に claims から文字列テンプレートで差し込む（≤ 0.05 ms / claim）。行のずれでは本文の cache が効いたまま、chip だけが新しくなる。S9 の再描画も安くなるので、こちらを推奨する。
- 試験: 再アンカーで cite が 3 行動いたあとの `GET /doc/sections/:id` の chip label と `data-*` が新しい範囲であること（AC-33 の UI 側）。

---

## PT-08 [medium] soft dep の要約が cacheKey をタイミング依存にする

**場所**: gen §3.3（soft dep: 依存先の S5 が終わっていれば生成済みの名前・要約、終わっていなければ仮名。「soft dep の状態は cacheKey に入る」）、§3.2（「plan 作成時に各 task の cacheKey を計算」）、§3.8、§8.4.1-2（session では同じ phase の soft dep は「prep 時点で未生成なので仮名で描かれる」）、AC-01・AC-22・AC-28。

**問題**:
- 1 回目の run では、C=3 で同時に走る S5 どうし（topo 順の隣接）が互いを仮名で見る。どの依存が先に終わるかは各 task の所要時間で決まる。したがって入力バイト（＝cacheKey）は**実行ごとに変わりうる**。
- 2 回目の run では、plan 時点で全 module の要約がそろっている。そのため plan 時に計算した key は、1 回目の dispatch 時の key と一致しない。1 回目に仮名を見た task は cache miss になり、再び課金される（AC-28「全 task cached」に反する）。
- session（phase 1 = 全 S5）は全員が仮名、claude-cli は一部が生成済みの名前になる。AC-22（`inputs/<id>.md` が claude-cli の stdin とバイト一致）は成り立たない。
- 見積りでも、plan 時の key で「再利用 12 件」と表示したものが、実際には走る。

**修正**: S5 の DEPS は index だけから決める（`ModuleInfo.name`（決定的な仮名）+ dominant dir + exported 上位 3 名 + edge weight）。生成済みの要約を使った統合は S6（親）と overview final が hard dep として行う（もともとそうなっている）。これで S5 は index snapshot の純関数になり、cache・golden・session の一致がそろう。品質への影響（DocAgent の順序効果）は eval の A/B（DEPS 要約あり/なし の claim S 率）で確かめる。差が出れば「要約は hard dep の厳密な bottom-up でだけ入れる」（並列度が下がる）を代替にする。

---

## PT-09 [medium] 出力上限が claude-cli では設計どおりに効かない

**場所**: gen §5.3（prompt ごとの max out 1,200〜6,000）、§3.6-5・§6.4-1(c)（`stop = max_tokens` で切り詰めを判定し「continue after」で再試行）、§8.2 argv（上限の flag なし）、loop §6.5.2（「1 つの result = 1 回の LLM 呼び出し」）。

**根拠 [実測]**:
- claude-cli に出力上限の flag は無い。バイナリには `CLAUDE_CODE_MAX_OUTPUT_TOKENS`（と `MAX_THINKING_TOKENS`）がある。
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS=120` で「1〜400 を出力せよ」を Sonnet low に投げた。stream には **`message_start` が 4 回**出て、どれも `stop_reason: "max_tokens"`、text は合計 640 文字（4 回分の続き）だった。`result` は `subtype: "success"`・`is_error: true`・`num_turns: 4`・`output_tokens: 480`（上限の 4 倍）で、`result` の本文は `API Error: Claude's response exceeded the 120 output token maximum…` に置き換わった。費用は $0.0088。
- env を付けない場合は CLI の既定上限（大きい）まで出る。止めるのは mitori の meter（`--max-budget-usd = max(0.05, 3 × 見積り)` の 80%）だけになる。

**影響**:
- `stop = max_tokens` は result の段では観測できない（CLI が自分で 3 回続けてから error にする）。spec の切り詰め再試行は、CLI の 3 回の上にさらに 1 回を足す（最大 5 回の API 呼び出し）。
- 続きの text が JSON 行の途中から始まるかは保証されない。LineAssembler の前提（1 本の連続した text）が崩れる。
- 暴走（同じ行を繰り返すなど）の上限が「見積りの 2.4 倍の $」になる。S5 1 本で最大 ≈ $0.1〜0.15。
- 「1 result = 1 呼び出し」は誤り。usage は合計されるので台帳は正しいが、較正（EMA の r）と「再試行は最大 1 回」の不変条件が、見えない継続で汚れる。

**修正**:
1. generate では `CLAUDE_CODE_MAX_OUTPUT_TOKENS = ceil(1.5 × (O_t + Θ_t))`（下限 2,000）を `ENV_INJECT`（PT-02）で渡す。
2. 正規化（loop §6.5.1）で、1 turn 内の 2 回目以降の `message_start` を `continuation` として数える。`result.is_error && result.result` が「exceeded the … output token maximum」に一致したら `stop: "max_tokens"` に写す（CT で文言の drift を監視する）。
3. gen は continuation が 1 回でも起きたら、そこで LineAssembler を閉じる（未完の行は捨てる）。その task には mitori 側の「continue after」再試行を**しない**か、するなら CLI の継続を禁じる方法を CT で探す。usage の `continuations` 数を `UsageRecord` に記録し、較正から外す。
4. PT-03 の compact 化で、上限に当たる確率そのものを下げる。

---

## PT-10 [medium] session engine の token が過小見積りで、しかも無駄が多い

**場所**: gen §8.4.2 の README テンプレート（「If you can start subagents, give each task to a fresh subagent with only these two files」）、§9.3（session は「claude-cli と同じ式で…参考値」）、§9.5（`σ_session = 6`）。Critic addendum E1（大きな生成の第一級経路）。

**問題**:
- task ごとの新しい subagent は、最初の user message（task id を含む）が毎回違う。そのため、その後に Read で読む `system.md`（gen.system + repo pack ≈ 12k）と `inputs/<id>.md`（≈ 14k）は、subagent 間で prefix を共有できない。claude-cli では cache read（0.1×）だった 12k が、session では task ごとに cache 書き込み（2×）になる: 37 task × 12k ≈ 0.44M token 相当が余分にかかる [推定]。
- subagent には Claude Code 自身の system prompt と tool 定義、ユーザーの skill 一覧などの基礎 context が付く。研究 06 の測定では、既定の `claude -p` はこの Mac で 18.8k〜112.7k token だった。subagent はそれより小さいが、≥ 10〜20k はあると見込む [推定、要実測]。
- Read tool は `cat -n` 形式で行番号を前置する。入力は既に `N|` 付きなので二重になり、1 行あたり ≈ +2〜3 token、コード中心の入力で ≈ +20〜25% [推定]。
- これらがユーザー自身の対話 session と 5h 枠を消費する。見積りダイアログの「session C=1」は claude-cli と同じ $ を出すので、実際の 1.5〜2 倍を過小に見せる [推定]。

**修正**:
1. README を「subagent 1 つにつき同じ phase の task を N 個（既定 6、input 合計 ≤ 100k token）まとめて処理する。最初に system.md を 1 回だけ読む」に変える。packet 側に `batches.json`（task の束）を用意する。同じ subagent の 2 本目以降は、system.md と前の task が cache read になる。
2. `GEN_ESTIMATE_PARAMS` に `sessionSubagentBaseTokens`（M-12 で実測）と `readLineOverheadTokens`（≈ 2.5 / 行）を足す。session の $ は「claude-cli の式 + 基礎 context × 束の数 + system.md の書き込み × 束の数 + 行番号分」で出す。
3. M-12（新規）: maintainer 機の実 Claude Code で、crit の phase 1 を「task ごとの subagent」と「6 task の束」の 2 通りで ingest まで通す。両方の usage（Claude Code の `/cost` か transcript の usage 合計）を測り、README の既定 N と見積り係数を決める。

---

## PT-11 [medium] 1 枚岩の `doc.index.json` を書き込みのたびに全部 serialize する

**場所**: `core.ts` `DocIndex`（blocks・claims（cite の blob・symbol・snippet hash を含む）・diagrams・glossary を 1 ファイルに持つ）、gen §10.8（canonical JSON）、§10.9（≤ 500 ms の debounce で write queue の中から flush。変わったファイルだけを書くためにバイト比較する）、§11.2-1（moved cite で link を書き換える）、§3.6-3（1 行が確定するたびに apply）。ADR-0004、synthesis R15（module ごとのファイルで merge 衝突を局所化する）。

**問題**:
- バイト比較をするには、まず全ファイル（巨大な sidecar を含む）を serialize する必要がある。gen §6.8 の例では block 1 つが ≈ 0.5 KB、claim がさらに ≈ 0.3 KB × 2 なので、10k block の文書（ADR-0003 の想定）では sidecar ≈ 8〜10 MB になる [推定]。キーを整列する canonical stringify は、main thread で 1 回 ≈ 100 ms 級になる [推定]。生成中は 500 ms ごとにこれを繰り返す。single writer の中で行うので、その間は `indexer.update` の反映・thread 作成（楽観カード 100 ms）・SSE が待たされる。保存 → stale バッジ 50 ms の経路（indexer §10.4）とも衝突する。
- cite の `blob` はファイルのどこが変わっても変わる。行番号はファイルの上の方の編集で変わる。cite されたファイルを保存するたびに、sidecar 全体と Markdown の link が書き換わる。`.mitori/` を commit している repo では、コードの commit ごとに設計書の diff ノイズが出る（module ごとにファイルを分けた狙いを sidecar が打ち消す）。

**修正**:
1. sidecar を doc ファイル単位に分ける（`doc/modules/<slug>.md` ↔ `doc/modules/<slug>.meta.json`。全体の目次と glossary だけを `doc.index.json` に残す）。block ごとの serialize 済み JSON 断片を memo し、変わった block の断片だけを作り直して連結する（O(変更)）。
2. 変わりやすい cite の情報（`blob`、`start`/`end`）は、commit される sidecar には「生成時の値」として持つ。現在の位置は `index.sqlite`（`doc_cites`）だけで追う。Markdown の link の書き換えは「対象ファイルが 10 s 静穏」か「`mitori` の明示 flush・`git commit` 前の hook（opt-in）」まで遅らせる。UI は SQLite の現在値で描く（PT-07 (b) と組み合わせる）。
3. flush の cadence を生成中は 2 s にする。serialize は write queue の外（snapshot をコピーしてから）で行い、rename だけを queue に戻す。
4. bench: 10k block の合成文書で「1 block の更新 → flush」の CPU を測り、≤ 5 ms（O(変更)）を予算にする。

---

## PT-12 [medium] anchor S2 の候補爆発

**場所**: loop §1.3 S2（「新本文で行数 n の窓のうち snippetHash == anchor.snippet のものを全部探す（先頭行の normLine hash 一致で候補を絞り、候補だけ窓 hash を計算）」）、§1.3 前処理（path ごとに共有するのは `lineMap` だけ）、§0.3 `anchor.batch1k` 50 ms / 100 ms。S2 は S3（Myers）より**前**に、blob が変わった全 anchor に対して走る。

**根拠 [実測]**: crit の大きな Go ファイル 5 本を `normLine` で数えた。`}` は 471〜1,113 回（全行の 15〜18%）、空行は 267〜693 回（≈ 10%）。先頭行が `}`・空行・`return`・`if err != nil {` の anchor（コードの選択範囲では普通にある）は、候補が数百〜1,000 を超える。候補ごとに n 行分の `normLine`（正規表現）と xxh3 を計算するので、n = 20 なら 1 anchor ≈ 2 万回の正規表現になる。1k anchor の 1/4 がこの形なら ≈ 500 万回、秒単位になり、50 ms を 2 桁超える [推定]。新規追加ファイルにも探索を広げる規則（変更ファイル 50 本まで）で、さらに倍になる。

**修正**:
1. path ごとの前処理に `lineId[]`（`normLine` → intern した整数。Myers の intern と共有する）と prefix rolling hash を足し、窓 hash を O(1) にする。
2. 候補を絞る行は、先頭行ではなく anchor の中で**新本文での出現数が最小の行**にする。
3. 先に S3 の写像先 `e` で窓 1 個を照合し（O(1)）、一致すれば S2 を飛ばす。全体探索は写像が等号でないときだけにする。
4. 候補数の上限（64）を超えたら S2 を打ち切り、S3/S4 に進む。
5. AR7 に「先頭が `}`・空行の anchor 50% × 1k」の病的ケースを足す。

---

## PT-13 [medium] 常駐する claude プロセスのメモリに予算が無い

**場所**: loop §6.6.1（warm: profile あたり ≤ 2、全体 ≤ 3、idle 300 s。CT-10 で RSS を測り、250 MB を超えたら既定 0）、§6.6.2（parked ≤ 3、10 分。gen の keepAlive は数えない）、ARCHITECTURE §2.3・§10.2（idle RSS ≤ 30 MB は daemon 本体だけを数える）。

**根拠 [実測]**（`perf-review/warm.py`、haiku）:

| | spawn → `system/init` | 書き込み → `message_start` | RSS |
|---|---:|---:|---:|
| cold（spawn 直後に書く） | 1.13 s | 1.77 s | 218 MB（turn 後） |
| warm（6 s 待ってから書く） | 0.015 s | 0.53 s | 待機中 **204 MB**、turn 後 210 MB |

warm で隠せるのは ≈ 1.1 s（spec の想定は 1.8〜2.8 s）。1 本 ≈ 204 MB は CT-10 の閾値 250 MB より小さいので、既定は warm のまま残る。

**問題**: warm 3 + parked 3 + 実行中 3 + gen keepAlive（数えない）で、claude プロセスは最大 ≈ 9〜10 本、≈ 2 GB になる。daemon の peak RSS（700 MB / 1 GB）は indexer だけ、idle RSS（30 MB）は daemon 本体だけを数えており、子プロセスを数える予算がどこにも無い。warm process は `POST /jobs/estimate`（Composer を開くたび）で起動する。

**修正**:
1. 予算 `agent.residentProcs`（待機中の warm + parked の合計）≤ 2、`agent.childRss` ≤ 600 MB（target）/ 1 GB（limit）を `bench/budgets.json` に入れる。
2. warm は「Composer が開いている間」だけにし、閉じたら 30 s で畳む。park の TTL は、Review 画面がその job を表示していなければ 2 分にする（repair の continuation は gate 直後に来るので、それで足りる）。
3. 見積り（gen §9.5、loop §8.1）の σ_cli を実測に合わせて 1.2〜1.8 s にする（M-5 で確定）。

---

## PT-14 [medium] idle RSS 30 MB は今の構成では守れない

**場所**: ARCHITECTURE §2.3・§10.2（idle RSS ≤ 30 MB / 50 MB）、indexer §0.3（idle 寄与 0 MB）、§11.3 `idx.rss.idle`（0 / 5 MB）、§1.1（S2〜S4 は main thread）、§1.1 の「読み取り API はメモリ上の最新 snapshot から答える」、§8（`findSymbols` はメモリ上の名前索引、palette 項目）。

**問題**: Worker の終了で解放されるのは Worker の heap だけである。main thread は S2〜S4（graph・Leiden・ref の集約。react で peak 690 MB）で heap を広げたうえ、snapshot・名前索引・path 集合・palette を保持する。JSC の heap はすぐには OS に返らない。100k LOC の workspace を開いたままの「idle」で 30 MB は物理的に無理で、0 token の画面を出した直後から予算を超える。予算が「workspace を 1 つも開いていない daemon」のことなら、実用上意味が無い。

**修正**:
1. 予算を 2 つに分ける: `srv.rss.idleEmpty`（workspace なし ≤ 30 MB）、`srv.rss.idleLoaded`（100k LOC を 1 つ開いて 60 s 無操作 ≤ 150 MB [仮]）。後者を bench で測る（crit・react で 10 回 scan した後）。
2. S2〜S4 も parse Worker（または専用の structure Worker）で行う。main thread には compact な表（typed array の symbol 表、path の intern 表）だけを返す。S2〜S4 の peak がプロセスの終了とともに消える。
3. `indexer.setActive(false)` の 60 s 後に、メモリ上の名前索引を SQLite（`idx_symbols`）からの遅延読み込みに切り替える。

---

## PT-15 [medium] palette と outline を全量で取り直す

**場所**: ARCHITECTURE §4.2（palette は「ETag = rev」）、ux §4.10（`index.changed` / `doc.outline` で rev が変わったら取り直す）、§2.3（rev は write queue が commit するたびに 1 つ進む）、`api.ts` `DocOutline.blocks: Record<BlockId, BlockMeta>`、ux §12.3（`doc.outline` → outline を取り直す）。

**問題**:
- palette（≤ 5 万件、label・yomi・romaji・alias。数 MB 級）は、workspace の全書き込み（thread 作成・生成の 1 block・verify）で ETag が変わる。生成中に ⌘K を開くと、毎回全量を取り直して Worker に load し直す。
- `GET /doc` は全 block の `BlockMeta`（gen・hash・claims id を含み、≈ 0.4〜0.5 KB / block）を返す。10k block で ≈ 5 MB。`doc.outline` は「節の追加・削除・並べ替え」で出るが、flows の `s3/<key>` の追加や節の状態の変化でも出るなら、生成中に何度も 5 MB を parse することになる（INP と JS heap 100 MB の予算を圧迫する）。

**修正**:
1. palette の ETag を `xxh3(indexDigest の symbol/file 部分 ‖ outline の節集合 ‖ glossary rev ‖ thread の id 集合)` にし、増分（`paletteDelta`）の SSE を足す。
2. `DocOutline` から `blocks` を外し、minimap と読者レベルに要る最小の組（`[id, section, depth, kind, verdictWorst, ord]` の配列。≈ 40 B / block）にする。`BlockMeta` は `doc.block.upsert` で client が増分に持つ。`doc.outline` は節の木だけを無効化する。

---

## PT-16 [low] Shiki の窓描画と compute Worker の冷えた起動

**場所**: ARCHITECTURE §2.4（compute Worker は「必要時のみ起動」）、§4.2（`GET /cite` は ±8 行の Shiki 済み HTML）、ux §4.3.6（hover 300 ms・先読み 65 ms）、§12.8（200 行の塊）。

**問題**: 窓だけを Shiki に通すと、窓の外で始まる block comment・template literal・docstring・raw string の内側を、コードとして誤って色付けする。最初の hover では compute Worker の起動 + Oniguruma の WASM + grammar + theme の読み込み（数百 ms 級 [推定]）を払うので、peek が 300 ms に間に合わない。

**修正**: blob ごとに全文の tokenize 結果（行ごとの token 列。100 行ごとに grammar の状態を checkpoint）を `doc_html` と同じ方式で cache し、窓はそこから切り出す。UI が接続している間は、compute Worker を 1 本保持して Shiki を初期化しておく（RSS は PT-14 の `idleLoaded` に含める）。

---

## PT-17 [low] `git cat-file` を 1 回ずつ spawn する

**場所**: indexer §7.7 `read()`（「`git cat-file` 経由」）。L1 の検証（claim ごと）、`GET /cite`（hover ごと）、bundle の CODE、accept（loop §7.8-8、ファイルごと）が使う。

**問題・修正**: spawn は 1 回 3〜8 ms [推定] で、100k standard の検証だけでも ≈ 3,000 回になる。workspace ごとに常駐の `git cat-file --batch`（stdin で oid、stdout で長さ付きの本文）を 1 本持ち、LRU（64 MB）を前に置く。clean なファイルの現在 blob は、stat が一致すれば fs から直接読む。

---

## PT-18 [low] warm-first の待ち方

**場所**: gen §3.5（「同じ key の task は 1 本目の最初の text delta まで scheduler が後続を止める」）、AC-04。ARCHITECTURE §2.6 は「最初の token」とし、記述が揺れている。

**修正**: 解放の条件を「`stream_event.message_start`（prefill が終わり cache が書かれた時点）」にする。thinking の分（早期 overview で ≈ 1〜2 s）だけ早く S5 を出せる。1 本目が message_start の前に失敗・cancel・timeout（10 s）したら、次の 1 本を新しい「1 本目」にする規則を足す（今の規定では後続が待ち続けうる）。

---

## PT-19 [low] patch job の全体 checkout

**場所**: loop §7.3（既定は全体 checkout、部分 checkout は 20k files 超だけ）、§7.11（ready の worktree は 24 時間・8 本まで保持）、§8.2（snapshot と LLM を並行）。

**問題・修正**: 時間は LLM の待ち（≈ 7 s）に隠れる。しかし 20k files・数百 MB の repo では、job ごとに数百 MB を書き、8 本保持で GB 級のディスクを使う。patch mode では、全体を要る gate（typecheck・test。しかも trust 済み）が無ければ worktree を作らない。§7.8-2 の hunk 採用と同じ `hash-object -w` + `update-index --cacheinfo` + `write-tree` で head を作り、format gate は変更ファイルだけを一時 dir に書いて実行する。全体の worktree は typecheck・test の gate が実行されるときだけ作る（lazy）。

---

## PT-20 [low] bundle の固定行を system prompt に移す

**場所**: loop §4.1（header・`DENY`・`GATE`・`ACCEPT` の固定文）、§6.9（system prompt は `{cwd}` だけを差し込む）。

**問題・修正**: `DENY`（既定の deny glob ≈ 45 token）と `ACCEPT` の固定 2〜3 行（≈ 25 token）は、workspace と mode ごとに不変である。それなのに tail（1 回使い切り、2×（PT-02 の後は 1.25×）で書き込み）に毎回入る。workspace の deny glob を content-addressed の system prompt file に入れれば（file 名は内容の xxh3 なので、同じ設定どうしで共有される）、cache read（0.1×）になる。効果は 1 呼び出しあたり ≈ 70 token 相当の小さいものなので、PT-02 の env 追加と同じ PR で行う程度でよい。

---

## 付録 A. 検証ログ（再現手順）

すべて `scratchpad/design-tmp/perf-review/` で実行した。env は `env -i HOME PATH USER LANG` に scrub し、`--setting-sources "" --strict-mcp-config --disable-slash-commands --tools "" --no-session-persistence --system-prompt-file sp.txt`、cwd は空ディレクトリ。

| 目的 | 入力 | 結果 |
|---|---|---|
| baseline | `p_empty.txt` | 495 token（cache なし） |
| full form（§6.8） | `p_full.txt` | 1,081 → 本体 **586**、1h 書き込み 1,081、$0.004368 |
| compact form | `p_compact.txt` + `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` | 878 → 本体 **383**、**5m 書き込み 878・1h 0**、$0.002239 |
| md だけ | `p_mdonly.txt` | 674 → 本体 **179** |
| 出力上限 | `p_long.txt` + `CLAUDE_CODE_MAX_OUTPUT_TOKENS=120` | `message_start` 4 回、全部 `max_tokens`、out 480、`is_error: true`、`num_turns: 4`、$0.0088 |
| warm と cold | `warm.py`（haiku） | 上の PT-13 の表 |
| 既存録画の再集計 | `scratchpad/*.json`（研究・design 時の 40 本） | サブスクの全 run で cache 書き込みは 1h のみ・`input_tokens` は 2〜26 |
| 規模別の試算 | `est3.py`（gen の `est2.py` の式に TTL と足場係数を足したもの） | §0 の表 |
| 行の頻度 | crit の Go 上位 5 ファイル | `}` 15〜18%、空行 ≈ 10% |

## 付録 B. 文書の修正依頼の一覧（担当別）

- **architect（ARCHITECTURE・core・api）**: PT-01（`SseEventMeta` の coalesce 定義）、PT-04（`SchedulerSettings.reserveInteractive`・`interactiveBurst`）、PT-06（§7.5 に gen の例外を明記）、PT-07（`doc_html` の key）、PT-13/14（RSS 予算の分割と子プロセスの予算）、PT-15（`DocOutline` の縮小、palette の ETag）。
- **gen spec / gen.ts**: PT-02（`GEN_ESTIMATE_PARAMS` の TTL・τ 確定、§9.6 の τ=0 列の削除）、PT-03（compact 行・メタの導出・O の式・M-10 の事前値）、PT-05（run 単位の pack/snapshot 固定、pack の再利用規則）、PT-08（DEPS の静的化）、PT-09（max out の env と continuation の扱い）、PT-10（README の束ね方・M-12）、PT-11（sidecar の分割・flush）、PT-18（warm-first の解放条件）。
- **loop spec / loop.ts**: PT-02（`ENV_INJECT`、profile key に値を入れる）、PT-09（continuation の正規化）、PT-12（S2 の算法）、PT-13（resident の上限・TTL）、PT-17（cat-file batch）、PT-19（lazy worktree）、PT-20（固定行の移動）。
- **indexer spec**: PT-05（pack の見出しから変わりやすい値を外す）、PT-14（S2〜S4 の Worker 化）、PT-17。
- **ux spec**: PT-01（client 側の reducer で text を連結）、PT-15（outline の増分保持）、PT-16（compute Worker の保持）。
- **testing spec**: SRV-I-016 の書き直し（PT-01）、CC-24 の追加（PT-02）、cross-task の cache 試験（PT-05/06）、AR7 の病的ケース（PT-12）、RSS bench（PT-13/14）、M-12（PT-10）。
- **MILESTONES**: WP-06 の `UNTRUSTED_FENCE` → `GEN_DATA_FENCE`（PT-06）。WP-05 の受け入れに「生成中の interactive の slot 取得 ≤ 50 ms」（PT-04）。
