# 設計レビュー: 横断整合性と実装可能性（consistency / implementability）

- 版: 2026-10-03 / 種別: adversarial design critic（観点 = ARCHITECTURE・ADR・specs・contracts・MILESTONES・JUDGEMENT の間の矛盾、欠けた／曖昧な契約、未定義の振る舞い、型の不一致、実装者が推測せざるを得ない箇所）
- 対象: `docs/design/ARCHITECTURE.md`、`adr/0001〜0011`、`specs/{generation,indexer,loop,testing,ux}.md`、`contracts/{core,api,indexer,gen,loop,ui}.ts`・`contracts/testing.md`、`MILESTONES.md`、`prototypes/JUDGEMENT.md`
- 表記: 重大度は critical / high / medium / low。各 finding に **根拠**（ファイル:行 または §）、**失敗シナリオ**、**修正案** を書く。

## 0. 検証したこと（機械的に確かめた事実）

1. **契約の型検査**: `contracts/tsconfig.json` は tsc 5.9.3 と tsc 6.0.3 の両方で 0 エラー（ARCHITECTURE 付録 A の主張は正しい）。`contracts/testing.md` 付録 A を `testkit.ts` として足しても 0 エラー（contracts/testing.md の主張も正しい）。
2. **横断の代入互換プローブ**（`scratchpad/design-tmp/consistency/probes.ts`、strict 設定のまま `noUnusedLocals` だけ外して tsc 6.0.3）: 予想した 11 件の不一致すべてで tsc がエラーを出し、「欠けている」ことを示す 9 件のプローブはすべてコンパイルできた。つまり**契約群は単体では型が通るが、互いに組み合わせると噛み合わない**。主なもの:
   - P1: `loop.SecretScanner` は `indexer.SecretScanner` にも `gen.SecretScanner` にも代入できない（`scan()` の戻り値が `SecretHit[]` と `{text, redactions}`、gen は関数型）。
   - P3: `DocIndex.modules[]` は `indexer.ModuleSeed[]` にならない（`slug`・`name`・`reps` が無い）。
   - P4: `GenCall.effort: ReasoningEffort | null` は `EngineRequest.effort: ReasoningEffort` に入らない。
   - P5: remote-readonly の accept（checkpoint なし）を `AcceptRes` で表せない（`checkpoint` 必須）。
   - P7: `FinishRes.job` は単数。batch の分割結果（`BatchJobPlan[]`）を返せない。
   - P8: `GlobalSettings.defaultEngine`（`generic`・`codex-cli` を含む）は `GenEngineId` に入らない。
   - P9: `AuthKind` は `StatusBarProps.engine.auth`（`"api"`）に入らない。
   - P11/P12: `PauseReason "budget"`、`ConfirmReason "window_risk"`、`GenRunReq.notBefore` は存在しない（gen spec・ui.ts が使う）。
   - コンパイルできた（＝欠落・矛盾の確認）: `SETTING_SCOPES` に global の `denyGlobs`・`gates`、workspace の `include` があるのに対応フィールドが無い／`WorkspaceOverrides.docDir`・`readerLevel` は `SETTING_SCOPES` に無い、`BlockMeta` に `aspect` が無い、`IngestReq.model`・`PrepInfo.phase`・`IngestReport.next` が無い、`WarmProfile` に予算が無い、`ROUTE_META["POST …/transition"]` に `clients` が無い、`POST /jobs/:job/pr`・`POST /doc/blocks/:block/expand` の route が無い。
3. **実 CLI**: `claude --help`（2.1.288）に `--restricted`・`--permission-prompts none`・`--tools ""`・`--disable-slash-commands`・`--system-prompt-snapshot` があり、`--system-prompt-file` は help に無い（設計の記述どおり。契約テスト CT-02 で守る前提は妥当）。`--no-session-persistence` の help は「cannot be resumed」と明記しており、既定 `--no-session-persistence` の下で `--resume` による repair は不可能（CONS-15）。
4. **欠けている文書**: `specs/` に server spec が無い（`ls specs/` = generation, indexer, loop, testing, ux）。ARCHITECTURE §3.2 の表と testing SRV-I-006/008 は「server spec が決める」と参照している（CONS-02）。

---

## 1. critical

### CONS-01 ［critical］ 各 spec の変更要求（CR）が core.ts / api.ts に 1 つも反映されておらず、WP-00 がその状態で契約を凍結する

- **根拠**
  - 未反映の要求一覧: gen spec §17.1 C1〜C12（`PauseReason "budget"`、`BlockMeta.aspect`、`DocIndex.modules[].name/summary`、`ModelDefaults.genLeaf`、`servedBy`、`GitReader.log`、`ClaimChecks.repaired`、`IngestReq.model`/`IngestReport.next`/`PrepInfo.phase`、`DocProposal.conflict`、`GenTaskView.error`、`window_risk`/`GenRunReq.notBefore`、refusal category、partial の kind）、indexer spec 付録 B CR-1〜CR-13、loop spec §14.3 の 1〜11、ux.md §16 R1〜R25、testing spec §11.1 CR-1〜CR-6、JUDGEMENT §9。core.ts / api.ts にはこのいずれも入っていない（§0 のプローブ P3・P10・P11・P12 ほか）。
  - MILESTONES WP-00（68〜84 行）: 「`contracts/core.ts`・`api.ts` を `packages/core/src/{domain,api}.ts` に移し」「契約ファイルと `packages/core` の型が一致（代入互換を検査するテスト）」。CR を解決する工程がどの WP にも無い。
  - 永続フォーマットの衝突: gen spec §6.8 の `doc.index.json` 例は block メタに `"aspect": "responsibility"` を書くが、`core.ts` `BlockMeta`（821 行）に `aspect` は無い。`FORMAT.docIndex = 1` の形が 2 通りある。`DocIndex.modules`（1114 行）は `{id, section, ifaceDigest}` だけで、indexer の seed 復元（§6.6、IDX-AT-34）に要る `slug`・`name`・`parent`・`reps` も、gen の module 行の保存先（C2 の `name`・`summary`）も無い。
- **失敗シナリオ**: 並列グループ A の 10 WP が凍結済みの core に対して実装を始める。WP-04（doc）は `aspect` を持たない sidecar を書き、WP-06（gen）は aspect 順で block を並べようとして保存先が無い。WP-03（indexer）は seed を `doc.index.json` から読めず、別マシンで開くと module ID・slug（= `doc/modules/<slug>.md` のファイル名）が変わり、commit 済みの設計書のファイルが全部入れ替わる。結合時（M1/M2）に永続フォーマットの破壊的変更が必要になり、ARCHITECTURE §0 の「ADR 必須」の手続きに乗る。
- **修正案**
  1. WP-00 の最初の成果物を「契約修正パス」にする: 上の全 CR を 1 つの台帳（`docs/design/contracts/CHANGES.md`: `id | 要求元 | 採否 | 反映先 | 理由`）で採否決定し、採用分を core.ts / api.ts に入れてから凍結する。
  2. 永続形を先に確定する（ADR-0004 の追補）: `BlockMeta.aspect?: BlockAspect`（`BlockAspect` を core へ）、`DocIndex.modules[]` を `{ id; section; ifaceDigest; slug; name; summary?; parent?; reps: RepoPath[] }` に統合（gen C2 と indexer CR-1 は同じ配列を別々に拡張しているので 1 つにまとめる）。
  3. CI に「全 spec の CR 表の各行が台帳で決着していること」の lint（`scripts/cr-ledger.ts`）を足す。

### CONS-02 ［critical］ composition root（server）の spec と契約が存在しないのに、横断の配線・不変条件の大半がそこに委ねられている

- **根拠**: `specs/` に server spec が無い。ARCHITECTURE §3.2 の表は platform・server・client・cli の所有を「server spec」としている。testing spec SRV-I-006「status は server spec」、SRV-I-008「server spec が採否を決める」。loop spec §14.4 の server 宛て依頼（`job.accepted` の配線、`ownThreads`、accept lock と write queue の順序）、gen spec §11.1・§12（server が再アンカーをまとめる、`syncBlocks` を呼ぶ）、ux §16 の多数の route 追加はすべて受け手がいない。`contracts/` にも `server.ts` が無い。
- **失敗シナリオ**: WP-09 は並列グループ A（WP-00 直後）なのに、次を推測で作ることになる: SSE の `id` 方式（CONS-04）、write queue の API と各ドメインへの渡し方（CONS-03）、settings resolver（`SETTING_SCOPES` の解釈、CONS-25）、trust request の生成・失効、Inbox の集約（loop・doc・trust・gen の 4 か所から）、`AnchoredItem` の組み立て（doc の claim と loop の thread を path で引き、結果を `setClaimChecks` と `applyReanchor` に分配）、S9 提案の配信（CONS-09）、`GET /doc/text`・`GET /digest` の出力書式、idempotency の保存先（ARCHITECTURE §5.3 は workspace DB の `srv_idempotency` だが global route にも使う）、docId の払い出し（CONS-11）、`mitori install` の実行場所（CONS-22）。各ドメイン WP がそれぞれ別の前提で作り、M1 の結合で衝突する。
- **修正案**: WP-00 と同時に `specs/server.md` + `contracts/server.ts` を作る。最低限: (a) `WriteQueue`（workspace 用 + state DB 用）、(b) SSE wire（id・replay・resync・throttle）、(c) 配線表（watcher → `indexer.update` → `anchor.reanchor`（入力の組み立て規則）→ doc/loop への反映 → `gen.onIndexDelta` → SSE、`job.accepted`/`round.completed`/`checkpoint.undone` の各手順）、(d) settings resolver の規則、(e) trust の状態機械、(f) Inbox の集約規則、(g) 全 route の handler 所有表（どのドメイン関数を呼ぶか）。

---

## 2. high

### CONS-03 ［high］ single writer の write queue が gen・loop・doc の deps に無い（indexer だけが持つ）。global の state.sqlite には writer が定義されていない

- **根拠**: `indexer.ts` 576 行 `WriteQueue` と `IndexerDeps.write`（601〜634 行）だけ。`GenDeps`（gen.ts 2130 行）、`LoopDeps`（loop.ts 2101 行）、`createDocStore` の deps（gen.ts 685 行）に write queue が無い。一方 gen spec §3.6-3「1 行が検証を通るたびに即 `applyGenerated`（単一 writer の queue 内で）」、DocStore の doc comment「mutations only inside the workspace write queue」、ARCHITECTURE §5.4「書き込みは write queue 内の IMMEDIATE transaction のみ」。state.sqlite（ledger・trust・calibration・workspace 登録）はワークスペースを跨ぐのに、ARCHITECTURE §2.3 の queue は「ワークスペースごと」しか無い。
- **失敗シナリオ**: gen の task は engine の text delta を非同期に受け、各行を確定する。server が API 呼び出しを queue で包むだけでは、この非同期の書き込みは queue の外で `doc.applyGenerated`・`gen_tasks` 更新を行い、同時に走る watcher → `setClaimChecks` と競合する（ADR-0009 が消したはずの二重書き込み）。loop の JobRunner も engine の result 後に job/thread 状態を書く。state.sqlite は 2 つのワークスペースの job が同時に `UsageLedger.record` して `SQLITE_BUSY`（PLAT-U-001 は `E_LOCK_TIMEOUT` にする）を起こしうる。
- **修正案**: `WriteQueue` を core §18 に移し、`GenDeps.write`・`LoopDeps.write`・`createDocStore` の deps に必須で入れる。「DocStore・ReviewEngine・JobRunner の状態変更は `write()` の中からだけ呼ぶ」を各契約の doc comment に書き、SRV-U-018 と同じ dev assertion（queue 外からの mutator 呼び出しで例外）を DocStore にも入れる。state.sqlite 用に daemon 全体で 1 本の `stateWrite: WriteQueue` を定義し、`createAgentBridge`・trust・workspace 登録に渡す。

### CONS-04 ［high］ SSE の `id` が 2 種類のカウンタを混ぜており、`Last-Event-ID` の replay と client の重複排除が壊れる

- **根拠**: api.ts 1460〜1476 行「`id: <rev>`」「Reconnect: Last-Event-ID ⇒ replay from the per-workspace ring buffer」と `SseEnvelope.rev`「per workspace; global events use the daemon counter」。`GET /events?ws=<ws>`（ui.ts SseClient、ux §12.3）は 1 本の stream で global イベント（`notice`・`engines.updated`・`workspace.updated`・`settings.updated` は `replay: true`）と workspace イベントを両方受ける。ui.ts の重複排除は `entityRev["ws:<ws>"]` に envelope `rev` と mutation 応答の `x-mitori-rev`（workspace rev）を混ぜて比較する。
- **失敗シナリオ**: 最後に受けたのが global の `workspace.updated`（daemon counter = 5,000）で、ws rev が 120 のとき切断 → ブラウザは `Last-Event-ID: 5000` を送る → server は ws の ring buffer で rev 5,000 以降を探し、何も replay しない（または gap と判定して毎回 `resync`）。逆に daemon counter が ws rev より小さいと、既に適用した workspace イベントを再送する。`ws:` entity では daemon counter の `workspace.updated` と ws rev の `x-mitori-rev` を同じ軸で比べるため、新しい値を古いとして捨てる。
- **修正案**: SSE の `id` を **daemon 全体の単調な `seq`**（イベントごとに +1、global・workspace 共通）にし、ring buffer は seq で持つ。envelope には `seq` と、workspace イベントだけ `rev` を載せる。重複排除は「workspace イベントは `(ws, rev)`、global イベントは `seq`」と型で分ける（`EntityKey` の `ws:` は `workspace.updated` の `summary` を global seq で扱う）。ux §16 R25 の `?last=` も seq にする。ADR-0009 の「`id = rev`」を改訂する。

### CONS-05 ［high］ secret scanner の契約が 3 通りあり、置き場所が DAG と両立せず、伏せ字の書式も 2 通り

- **根拠**: indexer.ts 544 行 `interface SecretScanner { scan(text): {text; redactions} }`、gen.ts 742 行 `type SecretScanner = (text) => {text; redactions}`、loop.ts 2485 行 `interface SecretScanner { scan(text): SecretHit[]; redact(text): {text; count} }`（プローブ P1 で非互換を確認）。loop spec §12.2 見出し「`@mitori/loop` の `createSecretScanner()`。gen・doc の export も同じものを使う」だが、`PACKAGE_DEPS` で gen・doc・indexer は loop を import できない。`createDocStore` の deps と `HtmlExporter` には scanner の port が無い（ARCHITECTURE §7.4 は export 前の scan を必須とする）。伏せ字: loop §12.2 `«redacted:secret:<id>»`、gen §5.1-6 / `GEN_DATA_FENCE.redaction` / indexer §7.5 / ARCHITECTURE §7.4 `«redacted:secret»`。gen AC-44・IDX-AT-45 は後者の文字列で検査する。
- **失敗シナリオ**: server は 1 つの scanner から 3 つのアダプタを作るしかなく、どれが正本か決まらない。loop の実装を共有すると gen・indexer の golden（token 数・バイト）が `:<id>` の分だけ変わり、prompt の cacheKey（gen §3.8 は置換後のバイトで計算）が scanner の版に依存して揺れる。doc の export は scanner を受け取る口が無く、secret scan をせずに HTML を書く実装がありうる。
- **修正案**: `SECRET_RULES`・`SecretHit`・`createSecretScanner`・単一の `SecretScanner { scan(text): SecretHit[]; redact(text): {text; redactions: number} }` を **@mitori/core**（純関数・正規表現だけで依存なし）に移す。伏せ字の書式を 1 つに決め（gen の cache 安定性を優先するなら `«redacted:secret»`、件数は別に記録）、`IndexerDeps`・`GenDeps`・`createDocStore`・`HtmlExporter` の factory・`LoopDeps` に同じ型で注入する。indexer CR-6 と同じ内容なので台帳（CONS-01）で 1 件にまとめる。

### CONS-06 ［high］ doc パッケージに課された claim の刻印・検証が、doc の依存（core + platform）と deps では実行できない

- **根拠**: gen spec §10.3「claim の無い link は新しい claim（kind `fact`、cite を刻印）にする」（load 時）、§7.5「`editBlock` 後に: cite link から claim を再導出 → 新しい link は … cite を刻印 → L0〜L2 を実行 → verdict 更新」、ARCHITECTURE §4.5「`apply: "doc"` → 3-way 検査 → L1 静的検証」。刻印には `indexer.file(path).blob`・`enclosingSymbol`・ファイル本文（`snippetHash`）が、L1 には Verifier（gen）が要る。`PACKAGE_DEPS["@mitori/doc"] = [core, platform]`、`createDocStore` の deps（gen.ts 685〜700 行）は `ws, db, hasher, ids, log, clock, events` だけ。`DocStore.editBlock`（gen.ts 646 行）は `Block` を返すだけで検証の口が無い。
- **失敗シナリオ**: 人が UI で block を直す（doc_edit の「設計書を修正」= P2 の範囲）、または外部エディタで cite link を書き足す → doc は claim を作れず、`Claim.cites[].blob/snippet` が空のまま `doc.index.json` に入る（`Cite` は全フィールド必須なので型上は偽値を入れることになる）。以後の再アンカー（`blob` 比較）・L2 検査が壊れる。誰が L1 を実行して `E_*` を返すのかも決まっていない。
- **修正案**: `ClaimStamper` port を定義し（`stamp(raw: RawCite[], span: ClaimSpan): Promise<{cites: Cite[]; checks: ClaimChecks}>`、実装は gen の `Verifier`）、server が `createDocStore` に注入する。あるいは doc は「未刻印の claim」を `pendingStamp` として記録するだけにし、server が write queue 内で `gen.restamp(blockIds)` を呼ぶ手順を server spec に書く。`DocEditRes` に検証結果（L0〜L1 の `CheckError[]`）を返すフィールドを足す。

### CONS-07 ［high］ 「agent は resolve できない」が api 契約に書かれておらず、bearer の呼び出しは human 扱いになる。実行系の設定も同じ穴を持つ

- **根拠**: loop spec §2.2（292 行）「resolve を含む `POST …/transition` は web だけに限る（api 変更要求 §14.3-11）」、§10.3（1614 行）「resolve の手段は無い（`ROUTE_META` で `transition` は agent から呼べない）」。しかし api.ts 1418 行 `"POST /ws/:ws/threads/:th/transition": { auth: "required", kind: "json", mutates: true }` に `clients` が無い（プローブ P15）。actor の判定は「bearer の reply・propose-resolution・patches = agent、その他の bearer = human」。同様に `PATCH /settings`（1373 行）も clients 制限なしで、`engines.generic.argv`（任意コマンド）・`engines.claude-cli.binary`・`envPassthrough`・`limits`・`security` を変えられる。ARCHITECTURE §7.1 は「`trust` の決定は ブラウザのみ」を同じ理由で決めている。`POST /ws/:ws/export` の `out`（任意の絶対パスに書く）も clients 制限なし。
- **失敗シナリオ**: api.ts だけを見て WP-09 を実装すると、bearer + `x-mitori-client: cli` の transition が human として通り、loop spec のセキュリティ不変条件（AC-L10/L73）が契約レベルで保証されない。設定を変える経路も同様で、「repo 由来のコマンドは trust 必須」なのに「設定で任意コマンドを登録」は CLI/MCP の bearer から 1 回の PATCH でできる。
- **修正案**: ROUTE_META に `"POST /ws/:ws/threads/:th/transition": {…, clients: ["web"]}` を入れる。`PATCH /settings` は `clients: ["web"]`（CLI から変えたいなら `mitori config set` を TTY 確認付きの別 route に）。`POST /ws/:ws/export` は `out` を CLI のときだけ受け付け、web は `GET /export/html`（download）に限る。SRV-I-002 に 3 件を足す。

### CONS-08 ［high］ Finish（push）と batch 見積りの契約が袋小路になっている

- **根拠**: (1) loop spec §2.4.2-3（366 行）: 合計見積りが `confirmAboveTokens` を超える、またはどれかの job が `requiresConfirm` なら Finish を `E_PRECONDITION` で断る。`FinishReq`（api.ts 770 行付近）には `estimateId`・`confirm` が無い。(2) `FinishRes.job` は単数（778 行、プローブ P7）だが `planBatch` は `BatchJobPlan[]`（loop.ts）を返し、question / review は 1 thread 1 job に分かれる。(3) UI の batch 見積り（ui.ts 1130 行、ux §5.3 C2・§4.6.4）は `POST /jobs/estimate {kind:"fix", threads}` だが、router の R8（loop spec §3.4）は intents が混在すると `E_INVALID_INPUT`。
- **失敗シナリオ**: 20 thread の round（question 3 + change 17）で Shift+F → Finish dialog の見積りが R8 で失敗して表示できない。push を押すと合計 > 100k token で `E_PRECONDITION`、確認を渡す手段が無いので**大きな round は永遠に送れない**（M4 の出口「Batch ≤ 単発合計の 0.7 倍」が試せない）。成功しても `FinishRes` は最大の job 1 本しか返せず、残りは SSE を待つ。
- **修正案**: loop §14.3-3 を採用し `FinishReq {mode; threads?; estimateId?; confirm?}`、`FinishRes {round; jobs: JobSummary[]; savedTokens?}`。batch の見積りは専用 route `POST /ws/:ws/review/estimate {threads?}` → `{partitions: {plan: BatchJobPlan; estimate: JobEstimate}[]; batchTokens; separateTokens; apiUsd; requiresConfirm; estimateId}` にし、Finish はその `estimateId` を確認として受ける。ui.ts の `FinishDialogProps.estimate` をこの型に変える。

### CONS-09 ［high］ S9 の再生成提案と「設計書を同期」の提案に、UI へ届く経路が無い

- **根拠**: `GenOrchestrator.onIndexDelta` → `IncrementalOutcome.suggestions`（gen.ts 2042〜2074 行）、`syncBlocks(…, {confirm:false})` → 見積り（loop spec §9.3-3 の「設計書を同期 ≈2k tok」カード）。api.ts に suggestions の route も SSE type も無い（`SseEventPayload` に `gen.suggestions` 無し）。ux §16 R12 が `GET /ws/:ws/gen/suggestions` と SSE `gen.suggestions` を要求中、ux §4.3.11 は「入るまでは freshness と scope 付き見積りで代用」。`doc.sync` を走らせる route はどこにも無い（`GenEstimateReq.scope` は節の再生成 prompt しか選べない）。
- **失敗シナリオ**: 本 session の範囲（P2「差分更新 S9」）の主機能である「この節だけ再生成」「設計書を同期」が end-to-end で動かない。fix の accept 後に設計書の同期を促すカード（loop §9.3-3、ARCHITECTURE §4.3 の図の最後）も出せず、D12 の「常に提案」の流れが途切れる。
- **修正案**: SSE `gen.suggestions {suggestions: (IncrementalSuggestion & {id: string})[]}`（replay、workspace scope）と `GET /ws/:ws/gen/suggestions`、実行用 `POST /ws/:ws/gen/suggestions/:id/run {confirm?}` → `GenRun`（`doc.sync` の場合は `syncBlocks(confirm:true)` に写す）を api.ts に入れる。server spec（CONS-02）に「`job.accepted` → `syncBlocks(confirm:false)` の結果を suggestion として発行」を書く。

### CONS-10 ［high］ S1 の床面図（P0 の 0 token 画面の主役）にデータ契約も所有パッケージも無い

- **根拠**: JUDGEMENT §6.3.4 に squarified treemap + Fiedler 順 + 扉 + 品質ゲート（30 ms・扉 45% 等）の算法があり「server・Bun Worker。決定的」「出力は `DiagramLayout`（kind `floorplan`）の `nodes` / `doors` / `groups`」。しかし `core.ts` `DiagramKind` に `"floorplan"` は無く、`DiagramLayout` に `doors`・polygon 無し、`MapView` に `fallback`・`quality` 無し（ux §16 R3 で要求中）。gen.ts `DiagramLayouter`（716 行）は ELK と sequence だけ。gen spec・indexer spec に床面図の算法は無い（grep で確認: gen spec は `s2:floorplan` という slot 名だけ）。
- **失敗シナリオ**: M1（P0 出口）は「`mitori` → 最初の有用な画面 ≤ 3 s」を床面図で判定するが、WP-04（doc、図のレイアウト）と WP-10a（web）がそれぞれ別の形を作る。UI 判定書にしか無い算法を誰が実装するか決まっていない（WP-04 の成果物一覧にも無い）。
- **修正案**: core に `DiagramKind "floorplan"`、`DiagramLayout.doors?`・`groups[].polygon?`、api `MapView.fallback?: "container"`・`quality` を入れる。算法を gen spec Part A（doc）§10 の新節に移し、`DiagramLayouter.layoutFloorplan(ir, prev?): Promise<DiagramLayout>` を契約にし、WP-04 の成果物と受け入れ試験（品質ゲート 4 指標、決定性）に足す。

### CONS-11 ［high］ 静的 block の ID が docId に依存するのに、docId を払い出す時点が定義されていない（式も 3 通り）

- **根拠**: gen.ts 358 行・gen spec §10.5「`b_` + base32(xxh3(`<docId>|<slot>`))[0..8]」。docId は `DocManifest` にしか無い。api.ts 549 行「Manifest (null before the first generation; static sections still exist)」、gen spec §6.5「manifest … run 完了時」。ADR-0004 は「`hash(module|section + slot)`」、core.ts `BlockMeta.slot` の comment は「`hash(moduleId + slot)`」と別の式。`DocManifest.effort: Effort` も必須（生成前に値が無い）。
- **失敗シナリオ**: scan 直後（S4）に `applyStatic` が §4・§5・§8 の静的 block を作る時点で docId が無い。実装が仮の docId を使うと、最初の生成で manifest が作られた瞬間に全静的 block の ID が変わり、生成前に facts 表や見取り図に付けたコメント（P0/P1 の主要フロー）が全部 outdated になる。式が 3 通りあるので、マシン間・版間で同じ block の ID が一致しない。
- **修正案**: 「最初の `applyStatic`（または `mitori init`）で docId を払い出し、manifest の骨格（`generatedAt: null`、`effort: null`、`models: []`）を書く」を gen spec §10 に追加し、`DocManifest.effort: Effort | null` にする。api の `DocOutline.manifest` は常に非 null にする。ID の式は core に 1 つ（`staticBlockId(docId, slot)` の純関数）だけ置き、ADR-0004 と `BlockMeta.slot` の comment を合わせる。

### CONS-12 ［high］ gate の trust hash が job ごとのファイル引数を含むため、毎 job で再確認になる（または実装者が正規化を推測する）

- **根拠**: `GateSpec.argv: string[]`・`trustHash: Sha256`「sha256 over the canonical spec + the config files it depends on」（core.ts 1840 行）。`GateDetector.detect({…, changed})`「Detect gate specs for the changed files」（loop.ts）。loop spec §7.6.1 の表の argv は `[gofmt, "-w", …files]`、`[biome, "format", "--write", …files]`、`[go, "test", "-count=1", …pkgs]` のように変更ファイルを含む。§7.6.2 の hash は「正規化した GateSpec 全部の JSON + 設定」。`EffectiveSettings.trustedGates: GateSpec[]` は静的な一覧を前提にしている。
- **失敗シナリオ**: job ごとに `files` が違うので hash が変わり、毎回 `trust.request`（または「未信頼で skip」→ gate なしで ready）。逆に実装者が勝手に files を除いて hash すると、ファイル引数の位置に任意の文字列を差し込める spec を区別できない。
- **修正案**: `GateSpec` を `argvTemplate: (string | {var: "files" | "pkgs" | "tests"})[]` にし、trustHash は template + 依存設定の内容だけから計算する。展開は `GateRunner.run` が行い、展開後の値は RepoPath 検証と `--` 区切りを必須にする。`EffectiveSettings.trustedGates` は template の一覧と明記する。

### CONS-13 ［high］ dirty ファイルの旧本文を保持する pin を loop が indexer に要求しているが、indexer spec は受けていない

- **根拠**: loop spec §1.8（209 行）「dirty ファイルの blob（git の object DB に無い）は indexer が `~/.mitori/repos/<ws>/blobs/` に content-addressed で保存する」、§14.4 indexer 宛て依頼 (1)。indexer spec にはこの保存の記述が無く（grep で `blobs/` 0 件）、§7.7 は「`blobText(blob)` … object が無ければ null（shallow clone で古い blob が無い場合など。anchor の cascade は S3 を飛ばす）」。
- **失敗シナリオ**: 典型的な作業状態（未 commit の変更があるファイル）で、2 回目以降の保存では旧 blob が object DB に無い → `blobText(oldBlob) = null` → Myers の行写像（S3）が使えず S2/S4/S5 に落ちる。範囲内を 1 行直すような編集で `outdated` が増え、`anchor.success ≥ 95%`（ARCHITECTURE §10.2、AR1/AR2 は commit 間の差分だけで測るので検出されない）が実運用で守れない。
- **修正案**: indexer spec に「pin store」を足す: `idx_blob_text(blob PK, bytes, refcount, last_ref_at)`（または `blobs/` ディレクトリ）、`Indexer.pinBlobs(blobs: GitOid[])` / `unpinBlobs`、dirty ファイルの hash 時に本文を保存、GC 7 日。AR1 に「dirty のまま 2 回編集」のケースを足す。

### CONS-14 ［high］ テスト計画（testing spec）が、確定した設計と矛盾する期待値を固定している

- **根拠と矛盾**（testing §10 AC-13 で §4・§5・§8 の全 ID はテストとして実装必須）
  - GEN-U-014「`claims[].text` が md の部分文字列でない → 不合格」: gen spec §6.6 で claim text 方式は廃止（marker `[[n]]`）。
  - GEN-U-023「不合格行は最後に 1 回だけ再要求（…`--resume`）、2 回目も不合格 → task `failed`」: gen spec §6.4 は continuation（parking）で再要求し、`--resume` は `CLAUDE_CLI_GEN_FORBIDDEN_FLAGS`（gen.ts 1895 行）で禁止、task を failed にするのは必須 aspect 欠落のときだけ。
  - GEN-U-022「256KB 超の 1 行」: gen の V30 は 16 KiB。
  - AGT-U-026「hang: SIGINT → 5 s → SIGTERM → 10 s → SIGKILL」、PLAT-I-005・MILESTONES WP-01「SIGINT→SIGTERM→SIGKILL」: loop spec §6.7「SIGINT → 8 s → SIGKILL。SIGTERM は使わない（result が出ない）」、`SIGINT_GRACE_MS = 8000`。
  - AGT-U-001〜012 は「I1〜I12」の独自番号（I8 = `keepStdinOpen: false`、I9 = auth source、I11 = 予算、I12 = canary）で、loop.ts の `CLAUDE_CLI_INVARIANTS` I1〜I14（I8 = tools、I13 = stdin、I14 = canary）と番号も中身もずれる。特に「I8 `keepStdinOpen: false`」は patch / agent の parking（§6.6.2）を禁止する。
  - CC-11「agent: tools ⊆ {Read, Edit, StructuredOutput}」: I8 は `Read,Edit,Glob,Grep[,Write]`。正しい実装で契約テストが red になる。
  - CC-02 の `REQUIRED_FLAGS` に、全 argv が使う `--permission-prompts` が無い（CT-01 の「argv template の全 flag が存在する」を満たさない）。
  - WEB-U-008・E2E-10「IME オンの読書面で `j` が効く（code 照合）」: ui.ts `isComposing`（357〜365 行）と ux §0.2 Δ4 は「keyCode 229 では何も発火しない（絶対）」と決定済み（ux §16 X1 で testing に改訂を依頼中）。
- **失敗シナリオ**: WP-12 が testing spec どおりにテストを書くと、仕様どおりの実装（WP-05・WP-06・WP-10a）で CI が落ちる。どちらを直すかの判断が実装者に委ねられ、誤った側（obsolete な設計）に合わせる修正が入りうる。
- **修正案**: testing §4.3・§4.4・§4.6・§8.2 の該当行を書き換える。AGT-U は `CLAUDE_CLI_INVARIANTS` から生成する（`AGT-U-I01…I14`、id を contract の `id` と一致させる lint）。GEN-U は `GEN_RULES`（V01〜V30・W01〜W08）から生成する。SIGTERM を使わないことを AGT-U に明記。CC-11 を I8 に合わせ、CC-02 に `--permission-prompts` を足す。WEB-U-008/E2E-10 を ux X1 に合わせる。

---

## 3. medium

### CONS-15 ［medium］ parking・resume・session 保存の規則が文書ごとに食い違い、既定設定では不可能な手順が書かれている

- **根拠**: loop.ts 708 行 I13「stdin closed right after the prompt for answer/findings/**generate**」に対し、752 行 `CLAUDE_MODE_DEFAULTS.generate.keepAlive: true`、loop §6.6.2「gen の generate mode も keepAlive: true を使える」、gen §6.4（continuation 再試行）。ARCHITECTURE §4.3 の図「`--resume` + 失敗抜粋 ≤1k」、ADR-0006「失敗抜粋 ≤ 1k token を `--resume` で返して最大 2 回 repair」、ADR-0011「同じセッションに再要求する（claude-cli は `--resume`）」、MILESTONES WP-08「repair ≤ 2 回 `--resume`」。ARCHITECTURE §7.3-4「既定 `--no-session-persistence`（follow-up が要る thread だけ例外）」に対し loop I4「例外は `engines.claude-cli.persistSessions = true` のときだけ」。CLI の help: `--no-session-persistence` は「cannot be resumed」。ARCHITECTURE §7.3 は「I1〜I12」、loop.ts は I1〜I14。
- **失敗シナリオ**: I13 の単体テスト（`keepStdinOpen === false` for generate）を書くと gen の continuation 再試行が壊れる。ADR / ARCHITECTURE を読んだ実装者は `--resume` 経路を主に作り、既定設定では必ず失敗する。thread 単位の保存例外（ARCHITECTURE）を実装すると I4 の契約テストと衝突する。
- **修正案**: I13 を「answer/findings は prompt 後に close。patch/agent/generate と warm は park のため open、park 終了で close」に直す。ADR-0006・ADR-0011・ARCHITECTURE §4.3・§7.3・MILESTONES WP-08 を「continuation → resume（persistSessions 時のみ）→ cold」の 3 経路に改訂する（gen §17.4 A1 の ADR 改訂依頼も同時に処理）。ARCHITECTURE §7.3 の範囲を I1〜I14 に。

### CONS-16 ［medium］ thread 作成の `Anchor` が server でしか計算できない値を必須にしている（web は hasher を持たない）

- **根拠**: api.ts 706 行 `CreateThreadReq.anchor: Anchor`。`CodeAnchor.snippet: Xxh3`・`blob` 必須、`DocAnchor.blockHash` 必須（core.ts §9）。web の依存は core + client だけで `Hasher` は platform の port。loop §1.2 は server が捕捉・再計算する手順を持つ。ux §16 R10 が `AnchorInput` を要求中。
- **失敗シナリオ**: web は `snippet` に偽値を入れて送るしかなく、server が「信用しない」と書いても型契約は「client が送る値」を正としている。CLI / MCP から thread を作る将来の経路でも同じ。
- **修正案**: `AnchorInput`（code: `{path, start, end, blob?, charRange?}`、doc: `{block, selStart, selEnd, quote?}`、diagram: `{diagram, node?|edge?}`）を api に定義し、`CreateThreadReq`・`PatchThreadReq`・`POST …/reanchor` はこれを受ける。server が `AnchorEngine.codeAnchor/docAnchor` で `Anchor` を作って返す。

### CONS-17 ［medium］ doc_edit（P2 の範囲）の編集欄に必要な Markdown 原文を取る API が無く、`DocEditReq.md` がどちらの形かも未定義

- **根拠**: `BlockView extends BlockMeta`（api.ts 526 行）で `md` を持たない（`Block` だけが持つ）。ux §16 R2「`GET /doc/blocks/:block?md=1` で `md`」要求中、ui.ts `ComposerState.docMd`「prefilled from the block」。block の md には file 形（cite link `（[login.go:40-78](../../…#L40-L78)）`）と marker 形（`[[1]]`）がある（gen §10.3）。`DocEditReq.md` はどちらか書いていない。`GET /doc/text` も「Markdown」としか言わない。
- **失敗シナリオ**: UI は編集欄を埋められない。file 形で送ると server は link の付け替え規則（数の不一致時の対応付け）を通すことになり、marker 形で送ると人が出典を足す手段が無い。どちらを実装するかで semantic hash と claim の同一性（gen §6.7-6）が変わる。
- **修正案**: `GET /ws/:ws/doc/blocks/:block?md=marker|file` → `BlockView & {md: string; mdForm: "marker"|"file"}`。`DocEditReq` に `mdForm` を必須で足し、既定は file 形（人が見る形。server が §10.3 の parse で claim を再導出、CONS-06 の stamper を通す）にする。`GET /doc/text` の書式（file 形、`ref=*` は全文、`depth` は Depth L0〜L3 の上限か節の深さか）を server spec で定義。

### CONS-18 ［medium］ hunk 単位の accept の意味が 3 通りあり、remote-readonly の accept は型で表せない

- **根拠**: api.ts 873 行 `AcceptReq.hunks`「Hunks to accept (others are discarded)」。loop §7.8-12（1417 行）「hunk の一部だけなら `partially_accepted`。残りは後で accept できる」、`JOB_TRANSITIONS.partially_accepted: ["accepting", "reverted"]`。JUDGEMENT §6.7 は hunk ごとに ⌘⌫ で却下し「全 hunk と全 block が決まった時点で適用」。`AcceptRes.checkpoint` 必須（880 行、プローブ P5）だが loop §7.8 の remote-readonly は `.patch` を書くだけで checkpoint を作らない。
- **失敗シナリオ**: 人が 3 hunk のうち 1 つを却下して 2 つを採用 → api 実装は 1 つを捨て、loop 実装は「後で accept 可」として残し、UI は「決定済み」として表示 → 次の accept で却下したはずの hunk が入る、または採用し残した hunk が二度と採用できない。remote-readonly では `AcceptRes` を作れず実装者が偽の checkpoint を返す。
- **修正案**: `AcceptReq {accept: HunkId[] | "all"; reject?: HunkId[]; proposals?: ProposalId[]}` にし、`Job` に `hunkDecisions: Record<HunkId, "accepted"|"rejected"|"pending">` を持たせる。`partially_accepted` は「pending が残る」状態と定義。`AcceptRes.checkpoint?: Checkpoint`（remote-readonly では無く `patchFile` 必須）を判別 union にする。

### CONS-19 ［medium］ session engine（prep / ingest）の API が spec の手順を運べない

- **根拠**: gen spec §8.4.1・§8.4.3-6・§17.1 C7、loop §10.5: `--model` で provenance を刻印、`IngestReport.next` で次 phase、`--continue <pr_id>`。api.ts の `IngestReq`（1003 行）に `model` 無し、`PrepInfo`（985 行）に `phase` 無し、`IngestReport` に `next` 無し、`POST /gen/prep` の body は `GenEstimateReq` で `continueFrom` を渡せない（`SessionEngine.prep(req, {continueFrom})` はある）。`PrepInfo.dir` の comment と loop §10.5 の stdout は `<repo>/.mitori/tmp/prep/<id>` だが gen §8.4.2 は `<docDir>/tmp/prep/<id>`（shadow では `~/.mitori/repos/<ws>/doc/`）。ROUTE_META の ingest は `maxBody 16 MiB` だが body は 3 フィールドで、server はファイルをディスクから読む（gen §8.4.3）。
- **失敗シナリオ**: phase 2 以降を始める手段が API に無く、session 経路（Critic E1 で第一級）が phase 1 で止まる。`BlockGenInfo.model` は必須なのに値の出所が無い。shadow workspace で CLI が誤った dir を表示する。
- **修正案**: C7 を採用（`IngestReq.model?: ModelId`、`IngestReport.next?: {prep: PrepId; phase: number} | null`、`PrepInfo.phase: number`）、`POST /gen/prep` の body を `GenEstimateReq & {continueFrom?: PrepId}` に。dir の表記は `<docDir>/tmp/prep/<id>` に統一。ingest の 16 MiB は「将来 inline content を受ける」なら `IngestReq.files?: Record<string,string>` を定義、受けないなら既定 1 MiB に戻す。

### CONS-20 ［medium］ ユーザーの agent への指示が衝突する（AGENTS.md「docDir を直接編集するな」vs prep README「out/ に書け」）

- **根拠**: loop.ts 2415 行 `agents-md/block@1`「Never edit `{docDir}/` directly.」。gen.ts `PREP_README_LINES`・gen §8.4.2「write only into out/」で、out/ は `{docDir}/tmp/prep/<id>/out/`。`.mitori/**` は `DEFAULT_DENY_GLOBS`。doc store の watcher は `.mitori/` の外部変更で `load()` を再実行する（gen §10.9、ARCHITECTURE §5.4）が tmp/・cache/ を除くとは書いていない。
- **失敗シナリオ**: Claude Code は常駐の AGENTS.md / CLAUDE.md の禁止を優先して `.mitori/tmp/prep/.../out/` への書き込みを拒否するか、ユーザーに確認を求める（session 経路の自動実行が止まる）。書けた場合も、out/*.ndjson を書くたびに doc store が全文書を再読込する。
- **修正案**: packet を docDir の外へ（`<repo>/.mitori-prep/<id>/`（`.gitignore` に追記）か `~/.mitori/repos/<ws>/prep/<id>/`。後者は agent の書き込み許可の範囲外になるので前者を推奨）、または AGENTS block を「Never edit `{docDir}/` except `{docDir}/tmp/prep/*/out/` when asked by `mitori gen --prep`」に。doc の watcher は `cache/`・`tmp/` を無視すると gen §10.9 に明記。

### CONS-21 ［medium］ CLI（＝ユーザーの agent）から生成 run を開始でき、D3 の「人の 1 クリック」を迂回できる

- **根拠**: ROUTE_META 1445 行 `"POST /ws/:ws/gen/runs": {clients: ["web", "cli"]}`、`GenRunReq {estimateId, confirm: true}`。ARCHITECTURE §2.2 の `mitori gen [--effort]`（push の run を始めるのか、確認をどう取るのかは未定義）。plugin の SKILL.md は `allowed-tools: Bash(mitori:*)`（loop.ts INTEGRATION_TEMPLATES）。
- **失敗シナリオ**: Pull 中の agent が `mitori gen --effort complete` を実行し、ユーザーの見積り確認なしに complete（100k LOC で ≈$8.5）を開始する。CLI 側の確認（TTY プロンプト）の有無は実装者次第。
- **修正案**: `POST /gen/runs` を web 限定にするか、CLI は `isatty` 必須の対話確認 + `--yes` を非 TTY で拒否と CLI 契約に書く。SKILL の `allowed-tools` を `Bash(mitori review:*), Bash(mitori bundle:*), Bash(mitori reply:*), Bash(mitori check:*), Bash(mitori gen --ingest:*)` に絞る（`mitori:*` は `stop`・`install`・`export`・`gen` まで許す）。

### CONS-22 ［medium］ 範囲内の機能に route が無い（実装者が勝手に足すか、機能が欠ける）

- **根拠と該当機能**
  - `mitori install`（P2 範囲）: `Installer` は workspace ごとの `createLoop()` の戻り値（loop.ts 2151 行）だが user scope の install は workspace に属さない。api に route が無く、ARCHITECTURE §5.4 は「daemon 稼働中に CLI がファイルや DB を直接書くことは禁止」。`~/.mitori/integrations.json` は ARCHITECTURE §5.2 の配置表に無い。ux R17 `GET /integrations` も要求中。
  - GitHub URL の PR 作成（D-items: fixes returned as patch/PR）: `JobRunner.pullRequest` はあるが route が無い（loop §14.3-7 要求中）。`mitori pr` は ARCHITECTURE §2.2 の CLI 一覧に無い。
  - placeholder の展開: `GenOrchestrator.expand(block, {confirm})` に route が無く、ux §4.3.10 は `POST /gen/estimate {scope:[section]}` で代用しており、2 つの経路の意味（deepdive placeholder の置換は section scope では表せない）が揃わない。
  - 節単位の翻訳: `translate(target: BlockId | SectionId)` はあるが route は block 単位だけ（ux R11）。
  - doc 編集の Undo: ui.ts `UndoTarget.docEdit {block, rev}` と ⌘Z があるが、api に block を履歴の版へ戻す route が無い（`DocStore.undoAccept` は提案の accept 用、checkpoint undo はコード用）。
  - Pull round の取り下げ: T4'「Pull round の取り消し」の route が無く、`POST /review/rounds/:n/complete` は CLI 限定。agent が戻らないと thread は `running` のまま。
- **修正案**: `POST /integrations/:target/install {scope, mcp, force}` と `GET /integrations`（global route、Installer を workspace から切り離して global の factory に）、`POST /ws/:ws/jobs/:job/pr`、`POST /ws/:ws/doc/blocks/:block/expand {confirm}`、`POST /ws/:ws/doc/sections/:section/translate`、`POST /ws/:ws/doc/blocks/:block/revert {rev, baseHash}`、`POST /ws/:ws/review/rounds/:n/withdraw`（web）を api.ts と ROUTE_META に足す。ARCHITECTURE §2.2 の CLI 一覧に `pr`・`--no-open`（testing RQ-CLI-1）・`gen --continue/--model/--partial/--scope`・`review --wait-sec/--no-open`・`doctor --calibrate/--reset-cache` を足す。

### CONS-23 ［medium］ 文書内リンクと palette の href が SPA の History ルーティングと合わない

- **根拠**: api.ts 511 行 `HTML_CONTRACT.cite`「`href="#/code/…"`」、indexer spec §8「href は `#/code/<path>:<line>`・`#/doc/modules/<slug>`」。ui.ts `APP_ROUTES`（History API、`/w/:ws/code/*path` + hash `#L40-L78`）。ux §2.3-3 は `a[href^="/w/"]` と `a.mcite` を横取りする。ux §16 R15 (a) が cite の href 変更を要求中（palette は対象外）。
- **失敗シナリオ**: palette の項目を選ぶと `#/code/…` へ遷移して router が解釈できない（`Router.parse` は unknown ⇒ launcher）。中クリックで開いた新しいタブも同じ。workspace key を含まない href はワークスペース切替後に別 repo を指す。
- **修正案**: core に純関数 `hrefs = { code(ws, path, start?, end?), doc(ws, section, block?), … }` を置き、doc renderer・indexer の palette・ui の Router が同じものを使う。`HTML_CONTRACT.cite` の href 書式を `/w/<ws>/code/<path>#L<a>-L<b>` に更新（R15 を採用）。

### CONS-24 ［medium］ 見積りの較正が 2 つの EMA で二重にかかり、一方は必要な値を台帳に持たない

- **根拠**: indexer spec §7.6（IDX-D13）: agent 所有の `factor(tokenizer, intent)` を「`result.usage` の入力 token 合計 T と呼び出し前の推定 E_raw」から更新し、`estimateTokens` の結果に掛ける（α 0.2/0.1、clamp [0.5, 2]）。gen spec §9.7: `UsageLedger.factor(intent = promptId, model)` の EMA（α 1/(n+1)/0.2、clamp [0.25, 4]）を `in_total = f_in · (P + I)` に掛ける。`UsageRecord.estimate` は {in, out} だけで E_raw（較正前）を持たない。ARCHITECTURE §5.3 は `use_calibration(tokenizer × kind × intent)`、gen は key `"gen.module|claude-cli"` × model。
- **失敗シナリオ**: gen が `estimateTokens(…, intent)` を使うと同じ偏りに 2 つの係数が掛かり、補正が発散・振動する（AC-24 の ±12% が出ない）。indexer の更新式は E_raw が台帳に無いので計算できない。
- **修正案**: 呼び出し単位の較正は 1 つ（gen の `UsageLedger.factor(promptId, model, engine)`）に決め、indexer の `factor(tokenizer, intent)` は廃止して `kindFactor`（単一 kind の exact count 由来）だけ残す。`UsageRecord.estimate` に `raw?: {in; out}` を足す。`use_calibration` の key 体系を ARCHITECTURE §5.3 と CR-7 で 1 つにする。

### CONS-25 ［medium］ settings のスコープ表（`SETTING_SCOPES`）と設定の型が一致しない

- **根拠**（プローブ P2）: `SETTING_SCOPES.denyGlobs.scopes = ["repo","global"]` だが `GlobalSettings` に top-level の `denyGlobs` は無い（`security.denyGlobs`）。`gates: ["repo","global"]` だが `GlobalSettings.gates` は無く、`GateSpec.source: "global_config"` が作れない。`include: ["repo","workspace"]` だが `WorkspaceOverrides` に `include` が無い。逆に `WorkspaceOverrides.docDir`・`readerLevel` は `SETTING_SCOPES` に無い（`readerLevel` は `ui.readerLevel` = global のみ）。core.ts 2711 行「per top-level key」。
- **失敗シナリオ**: resolver（server、CONS-02）の実装者が表をどう解釈するかで、repo の設定が通る／無視される範囲が変わる（セキュリティ境界: 「repo から実行系を設定できない」の判定がこの表に依存する）。
- **修正案**: `SETTING_SCOPES` を設定パス（`"security.denyGlobs"`、`"gates"`、`"include"`、`"docDir"`、`"ui.readerLevel"`）単位にし、各スコープの型（`GlobalSettings`・`WorkspaceOverrides`・`RepoSettings`）のキー集合と一致することを型テスト（`satisfies` で双方向の網羅）にする。`GlobalSettings.gates?: GateDeclaration[]` を足すか `source: "global_config"` を削る。

### CONS-26 ［medium］ doc パッケージの描画・図・export の factory と deps が契約に無い

- **根拠**: ARCHITECTURE §3.3 規則 5・§3.4「公開 API は `createXxx(deps)` のファクトリだけ」。gen.ts の `BlockRenderer`（706 行）・`DiagramLayouter`（716 行）・`HtmlExporter`（724 行）は interface だけで factory が無い。ELK と Shiki は compute Worker（ARCHITECTURE §2.4）だが doc は `WorkerPool` を受け取る口が無い。`HtmlExporter` は viewer ビルド（apps/web の成果物）の JS/CSS を inline する必要があるが、doc は apps/web に依存できず、bytes の受け渡しが未定義。scanner も無い（CONS-05）。
- **失敗シナリオ**: WP-04 と WP-13 が Bun API・ファイル読み込みを doc に直接書く（`check-boundaries` で落ちる）か、server に描画を寄せる（責務の移動）。どちらも結合時に差し替えが要る。
- **修正案**: `createBlockRenderer({highlighter: WorkerPool<HighlightReq, string>, log})`、`createDiagramLayouter({compute: WorkerPool<LayoutReq, DiagramLayout>, db})`、`createHtmlExporter({doc: DocStore, renderer, layouter, secrets, viewerAssets: {js: string; css: string}, clock})` を gen.ts Part A に宣言する。

### CONS-27 ［medium］ `GitReader` が各 spec の必要に足りず、indexer には代わりに git を呼ぶ手段も無い

- **根拠**: core.ts 3033 行 `GitReader` は `lsFiles/status/catBlob/head/branch/diffNames/objectFormat` だけ。不足: gen C5 `log`（COMMITS・CHURN）、api `MapView.overlays.churn`（90 日の commit 数）、`WorkspaceSummary.doc.commitsBehind`、indexer CR-5（`checkAttr`・`headTree`・`lsOthers({directories})`・`statusDirty`・`gitDir`・`lsFiles` の stage）。indexer spec §2.1 は「すべて `GitReader` 経由」と書くが、`IndexerDeps` に `Spawner` は無い。
- **失敗シナリオ**: indexer は §2.1 の argv（check-attr・rev-parse 3 回・status porcelain v2）を実行できず、`linguist-*` 属性・入れ子 repo の検出・dirty 判定の省略（warm 10 ms の根拠）が実装できない。gen の decisions / risks は COMMITS・CHURN が空になる（gen §17.5-6 で既知だが MapView の churn overlay は UI 側が値を前提にしている）。
- **修正案**: CR-5 と C5 を採用し、`GitReader` に `log`・`checkAttr`・`headTree`・`lsOthers`・`statusDirty`・`gitDir`・`revCount(from, to)` を足す。platform の実装（WP-01）の受け入れ試験に shadow repo での同じ結果形を含める。

### CONS-28 ［medium］ scheduler の状態変化を gen が観測する手段が契約に無い。生成に使えない engine を既定にできる

- **根拠**: gen spec §3.5「gen はそれ（yield）を観測したら `GenRun.state = "paused"` … 再開も scheduler の再開を観測して戻す（gen 自身はタイマーを持たない）」。`AgentScheduler`（loop.ts 604〜617 行）は `status()`・`window()` の pull 型だけで、購読の口が無い（`scheduler.updated` は SSE 用の `EventSink` に出るだけ）。`GlobalSettings.defaultEngine` は「push tasks and generation」の既定だが `GenEngineId` は `claude-cli | anthropic-api | session`（プローブ P8）。
- **失敗シナリオ**: gen は polling するか、run の状態が実態（yield 中）と食い違う。`defaultEngine = "generic"` のユーザーで生成見積りを取ると、未定義の動作（エラーか、黙って claude-cli か）になる。
- **修正案**: `AgentScheduler.subscribe(cb: (s: SchedulerStatus & {window: SubscriptionWindow | null; lanePaused: Record<Lane, PauseReason | null>}) => void): () => void` を足す。`GlobalSettings` を `defaultEngine`（push 用）と `defaultGenEngine: GenEngineId` に分けるか、gen spec に「生成の engine が gen 非対応なら claude-cli、それも無ければ session を提案」を書く。

### CONS-29 ［medium］ MILESTONES の受け入れ試験と予算の値が spec の実測・決定と矛盾する

- **根拠**
  - WP-02（107 行）「sig skeleton / full の比が crit で 0.10〜0.20」vs indexer §7.1.2 の実測 0.204・IDX-AT-41「[0.12, 0.24]」→ 実測値で WP-02 の受け入れが落ちる。
  - WP-03（116 行）「crit で … env 12」vs indexer IDX-AT-25「crit env 17」。
  - WP-06（147 行）「gen prompt 群（…`UNTRUSTED_FENCE`）」vs gen §5.1-4 `GEN_DATA_FENCE`（意図的に別）。WP-06「md に無い claim text」は marker 方式で廃止。WP-06・M2「citation L1 ≥ 90%」vs ARCHITECTURE §10.2・gen §7.4「≥ 92%（上限 85%）」。
  - WP-05（138 行）「spawn 不変条件の単体テスト 12 件」vs I1〜I14。
  - 再アンカー成功率: ARCHITECTURE §10.2「≥ 95% / 90%」、ADR-0007「≥ 95%」、loop §0.3 `anchor.success`「≥ 97% / ≥ 95%」。
  - 並列プールの式・debounce: ARCHITECTURE §2.4（`ceil(totalMB/2)`）・ADR-0002 vs indexer IDX-D2（`ceil(parseMB/0.75)`、perfCores）、ARCHITECTURE §4.4「30 ms debounce」vs indexer §10.1（leading 5 ms + max-wait 30 ms、CR-10）。
- **失敗シナリオ**: 担当者は MILESTONES の受け入れ試験を出口に使うので、正しい実装が出口で不合格になる、または不正確な値が `bench/budgets.json` に入る（CORE-U-009 で定数と一致を強制するので後から直しにくい）。
- **修正案**: MILESTONES の該当行を spec の値に合わせる（WP-02 は [0.12, 0.24]、WP-03 は env 17、WP-06 は `GEN_DATA_FENCE`・marker・L1 92%、WP-05 は 14 件、WP-08 は CONS-15 の 3 経路）。budgets.json の正本は「ドメイン spec の ID と値」（testing §0 の規則）と MILESTONES 冒頭にも明記。ARCHITECTURE §2.4・§4.4 は CR-10 を反映。

### CONS-30 ［medium］ 生成の cache key が system prompt の版を含まず、ARCHITECTURE・core の式とも違う

- **根拠**: gen spec §3.8・gen.ts `RenderedTask.cacheKey`「xxh3(promptVer + model + effort + lang + xxh3(userBytes))」（repo pack は意図的に除外）。`promptVer` は unit prompt の版（`gen.module@1`）で、`gen.system@n`・`doc.system@n`・addendum の版は入らない。ARCHITECTURE §9「変えた prompt に依存する cache だけ無効化」、§5.3「cache_key = xxh3(入力 digest × prompt ver × model × extractor vers)」、core `GenTask.cacheKey` の comment も同じ（extractor 版を含む）。
- **失敗シナリオ**: `gen.system@1 → @2`（出力契約や GROUNDING の文言を直す）を出しても、旧 system で生成した `gen_outputs` が 0 token で replay され、新しい規則に従わない block が残る（AC-28 の「2 回目は全 cached」が誤った結果を固定する）。
- **修正案**: cacheKey に `GEN_SYSTEM_VERSIONS[spec.system]` と（regen/retry 時は）addendum 版を加える。ARCHITECTURE §5.3・core の comment を gen の式に合わせて書き換える（extractor 版は userBytes の skeleton に暗黙に入る、と注記）。

---

## 4. low

### CONS-31 ［low］ `DOC_TEMPLATE` の行が spec と食い違う

- 根拠: core.ts 987 行 s8 は `source: "static"` なのに `generatedAt: ["overview","standard","complete"]`（`SectionTemplate.generatedAt` は「AI content を生成する effort」）。s6 の `depths: ["L2","L3"]` だが learn / recap は L1（gen C2）。ARCHITECTURE §2.7「静的節（§4/§5/§8）」だが s5 は `mixed`。
- 修正: s8 の `generatedAt: []`、s6 の depths に `"L1"`、ARCHITECTURE の表記を「static block を持つ節」に。

### CONS-32 ［low］ warm pool の profile の定義が 3 通りで、`--max-budget-usd` を argv に含む

- 根拠: ARCHITECTURE §2.6「model × effort × systemHash × tools」、loop.ts `WarmProfile`（539 行）は予算なし、loop §6.6.1「profile key = xxh3(binary + version + argv（prompt 以外の全要素）+ env の key 集合)」で argv は `--max-budget-usd <job 予算>` を含む。job 予算は見積りで変わる（§6.2.6）。
- 失敗: 予算が下限以外の job は warm を使えないか、warm 起動時の予算（保険）で走る。
- 修正: warm は mode 下限の予算で起動し、job 予算は meter（I12 の主役）だけで守ると明記して profile から外す。`WarmProfile` に `budgetUsd` を足すならそれを key に含める。3 か所の定義を loop.ts に一本化。

### CONS-33 ［low］ job 作成時の見積りずれを返す形が無い

- 根拠: loop §8 冒頭「見積りの差が ±20% を超えたら `E_CONFLICT` + 新しい見積り」。`MitoriErrorData.params` はスカラーだけで `JobEstimate` を運べない。
- 修正: `ApiErrorBody` を `{error; estimate?: JobEstimate | GenEstimate}` に拡張するか、`E_CONFLICT` の params に `estimateId` だけを入れ、client は `POST /jobs/estimate` を取り直すと規定。

### CONS-34 ［low］ 語彙・小さな型の食い違い（まとめ）

- `StatusBarProps.engine.auth: "subscription"|"api"|"unknown"` vs `AuthKind`（プローブ P9）→ `AuthKind` を使う。
- `PaletteItem.k` の `f`（file）・`b`（block）・`m`（module）に対応する `PaletteGroupResult.group` が無い（`room` = module か不明）→ 写像表を ui.ts に。
- `InboxFilter`（api: working/review/failed/mine/outdated/proposals/trust）vs `InboxView`（ui: all/mine/working/failed/outdated/draft/resolved）、WEB-U-034 は前者を前提 → ux R5 を採用し 1 つに。
- `TrustRecord.item: "repo_prompts"` は定義がどこにも無い → 削除か定義。
- `GenIdSource.next` に `glossary` が無く `GlossaryId` の払い出しが未定義（`setGlossary` は id を store が付けるとだけ）→ 決定的 id（`gl_` + base32(xxh3(docId|term))）を規定。
- `GenCall.effort: ReasoningEffort | null` vs `EngineRequest.effort` 必須（プローブ P4）→ gen は常に effort を渡し、anthropic-api の Haiku で落とすのは agent 側（I6）と統一、gen の `null` を削る。
- `JobReq.kind` の comment「explain = question/review answer」vs `planBatch` の「`review` for review」→ intent → JobKind の表を core に。
- JUDGEMENT §6.7 の `base refs/mitori/{job}/base` vs `GIT_REFS.jobBase` `refs/mitori/j/<job>/base`。
- ID の乱数源: core の `ID_ALPHABET` comment・gen §6.5 は `crypto.getRandomValues`、testing §3-1 は直接使用を lint で禁止（`Random` port CR-1）→ CR-1 を採用して comment を直す。
- `ExternalPatchReq.docUpdate` 必須 vs MCP `doc_update` 任意 → shim が null を補うと明記。

### CONS-35 ［low］ gate の env の `~` が展開されない

- 根拠: loop.ts 1998 行 `CARGO_TARGET_DIR: "~/.mitori/cache/cargo/{ws}"`。置換されるのは `{jobTmp}`・`{ws}` だけで、spawn は shell を通さない。
- 失敗: cargo が worktree の中に `~` という名前のディレクトリを作り、scope 検査（ignore された新規ファイル）や snapshot に混ざる。
- 修正: `{home}`（`resolveHome()` の絶対パス）を置換変数に足し `"{home}/cache/cargo/{ws}"` に。`{jobTmp}` の実体（`~/.mitori/repos/<ws>/tmp/<job>`）も ARCHITECTURE §5.2 に追記。

### CONS-36 ［low］ auto-commit が同じ accept で受け入れた設計書の変更を含めない

- 根拠: loop §7.8-11 `git commit --only … -- <C…>`（C = コードの変更集合）。設計書の提案の accept は doc store の flush（debounce 500 ms）で別に `.mitori/` に書かれる。`docCommitted = true` の repo でも commit に入らない。
- 失敗: commit の履歴でコードと設計書が別 commit（または未 commit のまま）になり、「設計書がコードと一致する」状態が commit 単位で崩れる。
- 修正: `docCommitted` のときは accept の write queue 内で doc を同期 flush し、`<docDir>` の変更ファイルを C に加えて同じ commit に入れる（または「設計書は別 commit」と明記して trailer で結ぶ）。

---

## 5. 優先順位の提案（WP-00 の前にやること）

1. CONS-01（CR 台帳の決着と永続形の確定）と CONS-02（server spec / contract）を WP-00 の必須成果物にする。これが無いと並列グループ A の前提が揃わない。
2. CONS-03・04・05・06・11 は WP-00 で core/api に入れる型の変更（write queue、SSE seq、secret scanner、claim stamper、docId と静的 ID の式）。
3. CONS-07・08・09・10・12・13 は該当 WP の着手前（WP-09・WP-07/08・WP-06b・WP-04・WP-08・WP-02）に spec を直す。
4. CONS-14・29 は testing spec と MILESTONES の書き換え（WP-12 の最初の PR の前）。

## 付録 A. 再現

- プローブ: `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/design-tmp/consistency/probes.ts`（`tsconfig.probes.json`）。実行: `cd <そのディレクトリ> && nix develop /Users/satoki252595/work/20261002_aiAgentTool --command npx -p typescript@6.0.3 tsc -p tsconfig.probes.json --noEmit`。期待どおり 11 件の error（P1a, P1b, P3, P4, P5, P7, P8, P9, P11a, P11b, P12）が出る。
- testkit: 同ディレクトリの `testkit.ts`（contracts/testing.md 付録 A を抽出）を `tsconfig.json` の `files` に足して 0 エラー。
