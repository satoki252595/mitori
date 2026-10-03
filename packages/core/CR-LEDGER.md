# packages/core/CR-LEDGER.md — 契約変更要求（CR）の台帳（living）

- 版: M0（2026-10-03、WP-00a で契約を `packages/*` へ移して凍結） / 所有: lead architect。R1 までの履歴は `docs/design/contracts/CR-LEDGER.md`（凍結スナップショット）。
- **M0 以後の正本はこのファイル**。`scripts/check-cr-ledger.ts`（`bun run check` の一部）がこの台帳を読む。
- 目的: ドメイン spec が出した core / api / 他契約への変更要求を **1 行 1 件**で精算する（CONS-01 / SC-01）。WP-00a はこの台帳が「全行 decided」であることを確認してから契約を凍結する。
- 規則
  1. spec に CR を書いたら、同じ PR でこの台帳に行を足す（`scripts/check-cr-ledger.ts` が spec 中の `CR-n` / `Cn` / `Rn` / `§14.3-n` 表記を拾い、台帳に無ければ CI を落とす）。表記の解決: 修飾つき `CR <scheme>-<n>`（`CR idx-6`・`CR gen-C7`・`CR ux-R2`・`CR m0-1` …）はどこでも有効。素の `CR-n` は直前の語（`indexer CR-10` → idx、`testing CR-5` → test）か、ファイルの既定（`specs/indexer.md`・indexer 契約 → idx、`specs/testing.md`・`contracts/testing.md`・testkit 契約 → test）で解決し、解決できなければ失敗（修飾して書く）。表の行: generation §17.1 `| Cn |` → `CR gen-Cn`、§17.2 `| Ln |` → `gL-n`、ux §16 `| Rn |` → `CR ux-Rn`、loop §14.3 の番号付き項目と本文の `§14.3-n` → `CR loop-n`。
  2. 決定は `accepted`（適用済み）/ `accepted-modified`（意図は採用、形を変えた）/ `deferred`（理由と目標 M を書く）/ `rejected`（理由）の 4 つ。
  3. 凍結後（M0 以降）の変更は **週 1 回のバッチ PR**（ラベル `contract-change`）。architect は 48 時間以内に採否を返す（SC-01）。各 WP は依頼を `docs/design/cr-requests/<WP-id>.md` に書き、architect がバッチでこの台帳の §3 以降に行を足す。
  4. 「適用先」は R1 で変更したファイルと型名。`tsc@6.0.3` 一括検査（core/api/indexer/gen/loop/ui/server の 7 ファイル）で 0 エラー。M0 以後の適用先は `packages/*/src/**`。

凡例: requester の略号 — idx = indexer spec 付録 B、gen = generation spec §17.1、gL = generation spec §17.2（loop への依頼）、loop = loop spec §14.3、ux = ux spec §16、jdg = prototypes/JUDGEMENT §9、test = testing spec §11.1 / contracts/testing.md §4。

## 1. core / api への要求

| id | requester | 決定 | 適用先（R1） | 理由・備考 |
|---|---|---|---|---|
| CR idx-1 | idx | accepted | core `DocIndex.modules: DocModuleEntry[]`（`slug`, `name`, `summary?`, `parent?`, `reps`） | gen C2 と同じ配列を拡張していたので 1 型に統合。slug は `SLUG_RE` で検証（SEC-01） |
| CR idx-2 | idx | accepted | core `ExcludeReason` + `fixture`, `special`。indexer `EXCLUDE_REASON_FALLBACK` 削除 | coverage の正直さ |
| CR idx-3 | idx | accepted | core `SymbolEntry.doc?` | palette / hover / MCP |
| CR idx-4 | idx | accepted | core `FactKind "config"`, `ConfigFact {tool, role}` | `Indexer.configs()` は内部詳細として残す |
| CR idx-5 | idx | accepted | core `GitReader`: `lsFiles().stage`, `lsOthers`, `statusDirty`, `checkAttr`, `headTree`, `gitDir` | §2.1 の argv を port で表す |
| CR idx-6 | idx | accepted-modified | core `SecretScanner {scan → SecretHit[]; redact → {text, redactions, rules}}`, `SECRET_RULES`, `REDACTION_TOKEN`, `createSecretScanner` | loop / gen / indexer の 3 形を 1 つに（CONS-05）。token は `«redacted:secret»` に統一 |
| CR idx-7 | idx | accepted-modified | core `CalibrationKey`, `CalibrationSnapshot`（`kindFactor` のみ）, `EmaState`, `CALIBRATION`, `emaUpdate` | 呼び出し単位の補正は ledger の `call:*` だけ（CONS-24、二重補正を防ぐ） |
| CR idx-8 | idx | accepted | core `FsReader`, `FsStat`（+ `isDir`, `readdir`, `realpath`） | indexer の `IndexerFs` は alias に |
| CR idx-9 | idx | accepted | core `RouteFact.dynamic?`, `FactBase.scope?` | — |
| CR idx-10 | idx | accepted | ARCHITECTURE §2.4（parse pool 式）・§4.4（leading 5 ms + max-wait 30 ms）、server `WATCH_BATCH` | 文書のみ + server 定数 |
| CR idx-11 | idx | accepted | core `ENV_TEMPLATE_GLOBS` | キー名のみ読む例外 |
| CR idx-12 | idx | accepted | core `RepoSnapshot.tree` 注記 | — |
| CR idx-13 | idx | accepted-modified | api `ScanSummaryView.stageMs?`, `notes?` | test CR-5 と重複のため名前を `stageMs` に統一 |
| CR gen-C1 | gen | accepted | core `PauseReason "budget"`（+ `window_spend`, `not_before`） | UXP-08・C10 と同時に整理 |
| CR gen-C2 | gen | accepted | core `BlockAspect`（gen.ts から移設）, `BlockMeta.aspect?`, `DocModuleEntry.name/summary?`, `DOC_TEMPLATE s6.depths += L1` | idx-1 と統合 |
| CR gen-C3 | gen | accepted | core `ModelDefaults.genLeaf`, `GlobalSettings.reasoning.genOverview` | — |
| CR gen-C4 | gen | accepted | core `BlockGenInfo.servedBy?`, `UsageRecord.servedBy?` | — |
| CR gen-C5 | gen | accepted | core `GitReader.log`, `revCount`, `isShallow` | CONS-27。shallow clone では空と UI に明示 |
| CR gen-C6 | gen | accepted-modified | core `ClaimChecks.l1: L1Result ("pass"\|"fail"\|"vacuous")`, `l0Raw?`, `repaired?` | `l1Vacuous` は tri-state に吸収（UXP-06 の `cited` verdict と一体） |
| CR gen-C7 | gen | accepted | api `IngestReq.model?`, `IngestReport.next?`, `PrepInfo.phase`, `PrepReq.continueFrom?` | CONS-19 |
| CR gen-C8 | gen | accepted | core `DocProposal.conflict?` | — |
| CR gen-C9 | gen | accepted | api `GenTaskView` に `error` | — |
| CR gen-C10 | gen | accepted | core `ConfirmReason "window_risk"`, api `GenRunReq.notBefore?` | 未較正時は `WINDOW_PRIORS` の上限で判定（UXP-08） |
| CR gen-C11 | gen | accepted | core `JobEvent.result.refusal?`（+ `continuations?`） | PT-09 と同時 |
| CR gen-C12 | gen | accepted | api `doc.block.partial.kind?/aspect?` | ux R13 と同一 |
| CR loop-1 | loop | accepted | core `THREAD_TRANSITIONS` + `proposed→failed(fail,system)`, `proposed→open(cancel,system)` | — |
| CR loop-2 | loop | accepted | core `PatchEdit.firstLine?/base?`, `ThreadOutcome`, `DocUpdate`, `PatchOutput/AgentOutput.docUpdates?/threads?` | loop の `ParsedPatch` は core 型を参照 |
| CR loop-3 | loop | accepted-modified | api `FinishReq.estimateId?/confirm?`, `FinishRes.jobs`, 新 route `POST /review/estimate → ReviewEstimate` | `ReviewStatus.batchEstimate` は専用 route に置換（CONS-08） |
| CR loop-4 | loop | accepted | api `AgentReplyReq.docUpdate?`, core `DocProposal.source.kind "agent_reply"` | — |
| CR loop-5 | loop | accepted | api `PatchThreadReq.dismissStale?` | — |
| CR loop-6 | loop | accepted | api bundle query `mode?: "pull"\|"copy"` | — |
| CR loop-7 | loop | accepted-modified | api `POST /ws/:ws/jobs/:job/pr`（**web のみ**、stretch） | SEC-04: agent が bearer で push できないよう CLI から外す |
| CR loop-8 | loop | accepted | core `DEFAULT_DENY_GLOBS`（実行トリガー・資格情報を統合）, `SECRET_PATH_GLOBS` | `LOOP_EXTRA_DENY_GLOBS` 削除（SEC-07・SEC-12 の追加分も同時） |
| CR loop-9 | loop | rejected（変更不要） | — | `JobFailure.params` で足りる（loop 自身の結論どおり） |
| CR loop-10 | loop | deferred（WP-16 着手時） | core `CODEX_PRICING` | codex は MVP 後。それまで `apiUsd 0`・`pricingVer "unpriced"` |
| CR loop-11 | loop | accepted | api `ROUTE_META["POST /ws/:ws/threads/:th/transition"].clients = ["web"]` | CONS-07 |
| CR ux-R1 | ux | accepted | api `PaletteItem.al?`, `via?`, `PALETTE_KIND_GROUP` | romaji は `r` にだけ適用（UXP-12） |
| CR ux-R2 | ux | accepted | api `BlockView.mdLine`, `variants?`, `BlockSourceView`（`?md=marker\|file`） | CONS-17 |
| CR ux-R3 | ux | accepted（stretch 実装） | core `DiagramKind "floorplan"`, `FloorZone`, `DiagramLayout.doors?/groups[].kind/zone/polygon`, api `MapView.fallback?/quality?/modules[].topFiles?` | 型は今、アルゴリズムは WP-18（SC-03） |
| CR ux-R4 | ux | accepted | api `SectionView.mapFlow?` | — |
| CR ux-R5 | ux | accepted | api `InboxFilter`（UI と 1 つの語彙）, `InboxItem.intent/anchor/cost/thread/job/displayState` | CONS-34 |
| CR ux-R6 | ux | accepted | api `FileContent.html?`（`?html=1`） | PT-16 の全ファイル tokenize cache から切り出す |
| CR ux-R7 | ux | deferred（M4） | api `GET /jobs/:job/diff?html=1` の query だけ先に定義 | 構文色付き diff は M4 |
| CR ux-R8 | ux | accepted | core `EstimateItem.path?/lines?` | — |
| CR ux-R9 | ux | accepted | api `JobEstimate.candidates?/history?` | — |
| CR ux-R10 | ux | accepted | api `AnchorInput`（CreateThreadReq / PatchThreadReq / reanchor） | CONS-16 |
| CR ux-R11 | ux | accepted | api `POST /ws/:ws/doc/sections/:section/translate`, `ConfirmReason window_risk`, `GenRunReq.notBefore` | — |
| CR ux-R12 | ux | accepted | api `GET /gen/suggestions`, `POST /gen/suggestions/:sg/run`, SSE `gen.suggestions`, core `SuggestionId` | CONS-09 |
| CR ux-R13 | ux | accepted | = gen-C12 | — |
| CR ux-R14 | ux | accepted | core `SectionNode.est?` | — |
| CR ux-R15 | ux | accepted | api `HTML_CONTRACT`（cite href = History route、`cs`/`cl`、`data-w/h`、`data-first`、`data-ln`）, core `HREFS` | CONS-23 |
| CR ux-R16 | ux | accepted | core `NOTICE_KEYS`, api `SectionView.terms?` | — |
| CR ux-R17 | ux | accepted | api `GET /integrations`, `POST /integrations/:target/install`, `IntegrationStatusView` | CONS-22 |
| CR ux-R18 | ux | accepted | = jdg Job.timings / diffStat.hunks / GateResult.autofixedLines | — |
| CR ux-R19 | ux | accepted | core `Job.windowDeltaPct?` | — |
| CR ux-R20 | ux | accepted（P3 実装） | api `DocEditReq.fromRev?` | 外部編集の「コードを合わせる」は P3 |
| CR ux-R21 | ux | accepted | core `UiSettings.editor` | — |
| CR ux-R22 | ux | accepted（cross-spec） | loop: doc_edit draft thread は Finish で送らない／draft thread も estimate 可（server spec §7.4） | 契約変更は無し（loop 実装規則） |
| CR ux-R23 | ux | accepted-modified | api `MessageView extends Message {html}`、`ThreadDetail.messages`、SSE `thread.message` | core `Message` は永続形のまま |
| CR ux-R24 | ux | accepted | = loop-3 | — |
| CR ux-R25 | ux | accepted-modified | api `GET /events?last=<seq>` | `last` は daemon-global `seq`（CONS-04） |
| CR jdg-1 | jdg | accepted | = ux-R1 | — |
| CR jdg-2 | jdg | accepted | = ux-R2 | — |
| CR jdg-3 | jdg | accepted | = ux-R3（MapView） | — |
| CR jdg-4 | jdg | accepted | = ux-R4 | — |
| CR jdg-5 | jdg | accepted | = ux-R3（DiagramKind/Layout） | — |
| CR jdg-6 | jdg | accepted | core `DiagramAnchor.pos?` | — |
| CR jdg-7 | jdg | accepted | core `Job.timings?`, `Job.diffStat.hunks` | — |
| CR jdg-8 | jdg | accepted | core `GateResult.autofixedLines?` | — |
| CR jdg-ui | jdg | accepted（UX author が適用済み） | ui.ts `ShortcutScope`, `ROUTE_SCOPES`, keymap, `UI_THRESHOLDS` | R1 で `docReview` scope を追加（UXP-16） |
| CR test-1 | test | accepted | core `Random` port, `newId`, `base32`, `IdTypes`; doc/gen/loop/server/agent deps に `random` | — |
| CR test-2 | test | accepted | core `Metrics` port, `METRIC_NAMES` | — |
| CR test-3 | test | accepted | core `UsageRecord.scope.kind "eval"` | — |
| CR test-4 | test | accepted | core `PackageName "@mitori/testkit"`, `PACKAGE_DEPS`、ARCHITECTURE §3.3 規則 5（`@mitori/<pkg>/testing`） | — |
| CR test-5 | test | accepted-modified | = idx-13（`stageMs`） | 重複統合 |
| CR test-6 | test | accepted | api `HealthRes.build` | — |
| CR arch-anchor | loop | accepted（文書のみ） | ARCHITECTURE §3.4 `createAnchorEngine({hasher})` | — |

## 2. 他 spec / 契約への cross-spec 要求（台帳管理のみ。適用は各 WP）

| id | requester → 相手 | 決定 | 適用先 |
|---|---|---|---|
| gL-1 | gen → loop | accepted | `EngineRun.events` は throttle なし（SSE の coalesce は server 側だけ、PT-01） |
| gL-2 | gen → loop | accepted | generate も parking（I13 R1）, `promptBlocks`, `apiLayout`, `fallbacks` |
| gL-3 | gen → loop | accepted | gen は `GEN_DATA_FENCE`（ARCHITECTURE §7.5 R1、PT-06） |
| gL-4 | gen → loop | accepted-modified | `UsageLedger.factor({engine, promptId, model})`, `windowFactor` |
| gL-5 | gen → loop | deferred（stretch） | Batch port（anthropic-api の Batch は SC-13 で範囲外） |
| gL-6 | gen → loop | deferred（stretch） | `Engine.countTokens`（同上） |
| gL-7 | gen → loop | accepted | CLI `mitori gen --prep [--continue]`, `--ingest [--partial] [--model]`, `NEXT:` |
| gL-8 | gen → loop | accepted | normalizer の refusal と category |
| gL-9 | gen → loop | accepted | claude-cli では Haiku にも `--effort` |
| gL-10 | gen → loop | accepted | `syncBlocks`（gen.ts 実装済み、server 配線は DOMAIN_WIRING） |
| loop→idx-1 | loop → indexer | accepted | 旧 blob の pin store（`pinBlobs/unpinBlobs`、`idx_blob_text`、CONS-13） |
| loop→idx-2 | loop → indexer | accepted | `symbolsAt(blob)`（indexer spec 改訂 R1 に記載。型は WP-02 で追加） |
| loop→idx-3 | loop → indexer | accepted（既存） | `IndexDelta.renames` |
| loop→idx-4 | loop → indexer | accepted | `estimateTokens` の kind 補正は `kind:*` のみ、行 prefix 分は loop の `lineOverhead` |
| loop→doc-* | loop → doc | accepted（既存） | `blockText`, `writeDecision`, `undoAccept`, superseded, `data-mx` |
| loop→server | loop → server | accepted | DOMAIN_WIRING（server.ts）、accept lock と write queue の順序 W4 |
| ux-X | ux → testing | accepted | WEB-U-008 / E2E-10 の期待値を「発火しない + hint」に（CONS-14） |
| ux→gen | ux → gen | accepted | renderer は Shiki css-variables、`HTML_CONTRACT` 追加属性、HtmlExporter は `ViewerPayload` |

## 3. M0 凍結（WP-00a、2026-10-03）— 契約の移設で生じた変更

移設先: `core.ts` → `packages/core/src/domain.ts`、`api.ts` → `packages/core/src/api.ts`、`indexer.ts` → `packages/indexer/src/contract.ts`、`gen.ts` Part A → `packages/doc/src/contract.ts`・Part B → `packages/gen/src/contract.ts`、`loop.ts` §A → `packages/anchor/src/contract.ts`・§B → `packages/agent/src/contract.ts`・§C → `packages/loop/src/contract.ts`、`server.ts` → `packages/server/src/contract.ts`、`ui.ts` → `apps/web/src/contract.ts`、`testing.md` 付録 A → `packages/testkit/src/contract.ts`。代入互換検査（契約スナップショットの全 export 1,024 件 == package の export、SC-01）を 1 回だけ実行して全件一致を確認し、検査コードは削除した（commit 履歴に残る）。

| id | requester | 決定 | 適用先（M0） | 理由・備考 |
|---|---|---|---|---|
| CR m0-1 | architect | accepted | core §20 `CodeSlice`・`SymbolChange`・`IndexDelta`（`contracts/indexer.ts` から移設）。`@mitori/indexer` は同名で re-export | doc（`BlockRenderer.highlight`）と anchor（`AnchorEngine.reanchor`）が使うが、`PACKAGE_DEPS` 上 doc・anchor は indexer を import できない。形は不変 |
| CR m0-2 | architect | accepted | doc 契約 A5 `GenIdSource`・`NewBlockRef`・`RawCite`（gen.ts Part B から移設）。`@mitori/gen` は同名で re-export | Part A の store API（`createDocStore`・`GeneratedBlock`・`ApplyResult`・`ClaimStamper`）が使う。doc は gen を import できない。形は不変 |
| CR m0-3 | architect | accepted | `declare function` / `declare const` は所有 WP の sub-directory の `index.ts` に `E_UNSUPPORTED` スタブとして置き、契約ファイルには `// name → module` の印を残す。`priceUsage`（agent）・`canonicalJson`（doc）・`bandOf`（web = `tokenBand`）は core 実装の re-export、`resolveSafePath`（server）は `@mitori/platform` の実装（WP-01）の re-export。migration 配列のスタブは `[]`、値のスタブは触ると `E_UNSUPPORTED` を投げる proxy | 所有ディレクトリ（MILESTONES §1.2）の内側で実装を差し替えられるようにする。署名は変えない（変えるなら CR） |
| CR m0-4 | architect | accepted | core に純関数を追加: `MitoriError`（+ `isErrorCode`・`isMitoriErrorData`・`toErrorData`・`unsupported`・`unsupportedValue`）、`isId`、`parseRepoPath`・`repoPath`、`canTransition`・`threadTransition`・`assertTransition`・`TransitionQuery`、`priceUsage`、`tokenBand`、`canonicalJson`、`shannonEntropy`・`isPlaceholderSecret` | MILESTONES WP-00a 成果物 3。境界での検証（RepoPath・id・遷移）を 1 か所に |
| CR m0-5 | architect | accepted | testing spec CORE-U-007 の期待値: `.envrc`（SEC-12 の実行トリガー）と `docs/.env.md`（`**/.env.*`）は**拒否される**側に訂正。deny glob は picomatch `{ dot: true }` で照合 | 本文の表が R1 の `DEFAULT_DENY_GLOBS` より古い。契約が勝つ |
| CR m0-6 | test | accepted-modified | testkit の公開面（`contracts/testing.md` 付録 A）を `packages/testkit/src/contract.ts` に移設。`contracts/testing.md` §1 で platform/agent の `testing` が提供するとされた helper（`memDb`・`createFakeClock`・`createReplaySpawner` …）も当面は testkit にスタブを置く | 型が testkit 契約にあり、platform・agent は testkit を import できない。WP-01 / WP-05 が自分の `testing.ts` に実装したら testkit は re-export に置き換える（型の移設は次の CR バッチ） |
| CR m0-7 | architect | accepted | MILESTONES §1.2: WP-03 の所有に `packages/indexer/src/resolve/`（indexer spec 冒頭の構成）、WP-11a に `scripts/build-bin.ts`、WP-10a に `apps/web/{index.html,vite.config.ts}`、S10 に `packages/testkit/src/**`（contract.ts 以外）を追加。root の placeholder script（golden・bench・bench:compare・e2e・eval・contract-test・size）は `scripts/run-owned.ts` が所有者のファイル（`bench/runner/golden.ts` 等）を作られ次第実行する。単独所有パッケージにも sub-directory を計画（platform: sqlite・hash・spawn・worker・watch・fs・lock・log・random・clock・metrics・git、anchor: normalize・linemap・engine、agent: claude・normalize・usage・adapters・scheduler・ledger・bridge、doc: codec・store・render・layout・export、gen: line・prompts・planner・verify・engines・session・orchestrator・incremental・ondemand・translate、client: http・sse、testkit: home・ports・fixtures・golden・cassette・server・perf・browser） | `src/index.ts` は integrator だけが変えるので、公開面の置き場を先に作っておく |
| CR m0-8 | test | accepted-modified | fixture の truth は `fixtures/truth/<name>.json`（MILESTONES 成果物 10）。testing spec §1.2 の `fixtures/repos/<name>/truth.json` を置き換える。`fixtures/build.ts` の copy 除外はそのまま | WP-00b の所有（`fixtures/truth/*`）と `bun test fixtures/truth` に合わせる |
| CR m0-9 | architect | accepted | `@mitori/testkit` は `packages/testkit`（testing spec §1.2 の root `testkit/` ではなく）。`bunfig.toml [test] preload` は WP-00b/WP-12 が `packages/testkit/src/preload.ts` を作った時点で有効にする | MILESTONES 成果物 1 |

## 4. CR バッチ 1（architect、2026-10-03）— M0 完了 WP（WP-00a・WP-00b・WP-11a）の依頼

入力: `docs/design/cr-requests/{WP-00a,WP-00b,WP-11a}.md`。「適用者」が architect 以外の行は、その WP が自分の所有ディレクトリで適用する（brief の notes に記載）。

| id | requester | 決定 | 適用先 | 理由・備考 |
|---|---|---|---|---|
| CR m0-10 | WP-00a | accepted-modified | 新 `packages/client/src/contract.ts`: `ConnectionState`・`EntityKey`・`SseClient`・`ApiClient`（web 契約 §5 から移設、web は同名で re-export）+ `ClientAuth`（`session` / `bearer`）・`ClientOptions {base, auth, client:{kind,version}, headers?, fetch?}`・`SseClientOptions {random, clock, onState?}`。スタブ `createApiClient`（`http/`）・`createSseClient`（`sse/`）。`ApiClient.call` の args に `onRev?(rev)` を追加 | 「`x-mitori-rev` も返す」を型で表せる形にした（戻り値の形は不変）。jitter と `live.since` は core の port（client は entropy 免除でない）。実装 WP-09、利用 WP-10a・WP-11 |
| CR m0-11 | WP-00b | accepted | testkit 契約 `FixtureName` + `"secrets"` | SEC-07 / RT-32。`fixtures/truth/security-fixtures.test.ts` の `as FixtureName` と `CR-PENDING(WP-00b)` は S10（WP-12）が外す。偽の secret 形文字列（`AKIA…`・`sk-ant-api03-FAKE…`・PEM）は意図どおり。push protection が止めたら `fixtures/repos/{injection,secrets,edge-inventory}`・`fixtures/injection/` を allowlist |
| CR m0-12 | WP-00b | accepted-modified | truth の spec 衝突（cr-requests/WP-00b.md A）: A1・A4・A5・A6・A7・A8 は truth のまま確定。**A2 は反転**: `.env.example` の `TSUNDOKU_DEBUG_SQL` は `forbiddenFacts` から `facts` へ（S10 = WP-12 が `fixtures/truth/ts-small.json` を直す）。A3 は truth のキー（`script:` / `main:`+`bin:`）を採り、indexer spec の `entry.python@1`・`entry.rust@1` 行を合わせた。testing spec §2.3.1・§2.3.9・IDX-U-004 に `ENV_TEMPLATE_GLOBS` の例外を明記。B の規約（`fixtures/truth/README.md`）は採用 | 契約（core `ENV_TEMPLATE_GLOBS`: env 検出器はキー名を読んでよい）が spec 本文に勝つ。`EntryFact.entry` は `script` を持つ |
| CR m0-13 | loop→idx-2 | accepted | indexer 契約 `Indexer.symbolsAt(path, blob): Promise<SymbolEntry[] \| null>` | 言語の決定に path が要る。null は blob 本文が無いときだけ。実装 WP-02 |
| CR m0-14 | WP-11a | accepted-modified | server 契約: `migrationsFor(db: Migration["db"]): readonly Migration[]`（スタブ `wiring/`、WP-INT が実装） | 2 関数の提案を 1 関数に。cli は agent を import できないため composition root が集める。`apps/cli/src/daemon/serve.ts` の `CR-PENDING(WP-11a)` は WP-INT 実装後に S9（WP-11）が置き換える |
| CR m0-15 | WP-00b | accepted-modified | root scripts `fixtures:build`・`corpus:fetch`・`budgets:merge`。`scripts/check-budgets.ts`（`check` の一部）が `budgets-merge --check` 相当（`bench/budgets.json` の陳腐化も検出）。`ci:pr` に `fixtures:build --verify`。testing spec §1.3 の `corpus:fetch` を `scripts/fetch-corpus.ts` に訂正 | PR CI での `fetch-corpus --only crit,flask --verify`（actions/cache）は **deferred**: PR で corpus を読むもの（WP-12 の bench smoke）が入るときに同じ PR で ci.yml に足す（architect に依頼） |
| CR m0-16 | WP-00b | accepted | `flake.nix` `devShells.default` に go・python3・rustc・cargo・rustfmt（`ci` と同じ `fixtureToolchains`） | testing spec §1.4（ホストの toolchain に頼らない）。go-small・py-small・rust-small を nd で検証済み（go 1.26.8 / Python 3.14.7 / rustc 1.98.1） |
| CR m0-17 | WP-00b, WP-11a | accepted | `fixtures/`・`bench/`・`test/`・`e2e/`・`eval/` に `tsconfig.json`（全 package を reference）、root `tsconfig.json` から参照 | `tsc -b` が fixtures・truth・budgets・skeleton・今後の int/e2e/eval を検査する |
| CR m0-18 | WP-11a | accepted | `bunfig.toml [test] pathIgnorePatterns` + `dist/**` | build 出力の `*.test.ts` を拾わない |
| CR m0-19 | WP-11a | accepted | `apps/cli/package.json` dependencies + `elkjs@0.12.0`・`web-tree-sitter@0.27.0`・`@shikijs/{core,engine-oniguruma,langs}@4.5.0`（`bun.lock` 更新、`--frozen-lockfile` 緑） | hoisted linker に頼らない。Worker entry の server への移設（indexer spec §3.3）は WP-INT のまま |
| CR m0-20 | WP-11a | accepted-modified | testing spec §6: `bin.size` の target 85 MB は darwin-arm64、linux-x64 は 88 MB（limit は両方 95 MB）。`bench/budgets/cli.json` に `bin.size.linux-x64`（88 / 95）を足し `apps/cli/src/build/size.ts` を target 別にするのは S9（WP-11） | linux-x64 は Bun runtime だけで 81.3 MB |
| CR m0-21 | WP-11a | accepted | `.claude/skills/mitori-release-build/`（build:bin → size → test/skeleton、release、lock 更新手順） | 繰り返す手順の skill 化 |
| CR m0-22 | WP-00b | deferred（M1、WP-09 の settings resolver） | core `DEFAULT_LIMITS`（CORE-U-009 の `Limits` 比較） | USD 上限（`jobMaxUsd`・`genRunMaxUsd`・`dailyMaxUsd`）の既定値が spec に無い。WP-09 が既定値を決めたら core に定数を足し、WP-12 が CORE-U-009 に比較を足す |
| CR m0-23 | WP-00b | deferred（WP-12・各所有 WP） | cr-requests/WP-00b.md E: `gostd` の lock（初回 online の `--update-lock`）、`gen:*` fixture の generator、`indexerFromGolden`（WP-02/03 の golden 後）、`bench/*.bench.ts` の measure、`gen.std.100k`（O2 の実測後） | いずれも担当 WP の作業で、契約変更は不要 |
