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

## 5. CR バッチ 2（architect、2026-10-03）— M1 結合（WP-01〜WP-12・WP-INT の依頼、`docs/progress/M1.md` §4・§6）

入力: `docs/design/cr-requests/{WP-01,WP-02,WP-03,WP-04,WP-05,WP-06,WP-07,WP-08a,WP-09,WP-10a,WP-12,WP-INT}.md` と M1 報告 §4（WP ごとの残り）・§5（見た目の差）・§6（CR 一覧）。WP-00a・WP-00b・WP-11a はバッチ 1 で回答済み（新規なし）。

適用の規則（このバッチ）:
- 「適用先」に **(applied)** とある行は architect がこの commit で契約（`packages/core/src/**`、`packages/*/src/contract.ts`、`apps/web/src/contract.ts`）に入れた。契約に増えた interface メンバーの実装がまだ無いものは、所有ディレクトリに `E_UNSUPPORTED` スタブ（または `null` を返す honest default）を置き、コメントに CR id と実装担当を書いた。呼び出し側の型エラーは最小限の修正で直した（`check`・`test` は緑）。
- **(WPxx applies)** の行は、その WP が自分の所有ディレクトリで適用する。sub-directory `index.ts` の関数シグネチャと、実装と同時でないと型が通らない契約行（例: `HighlightReq.lang` と grammar の追加）は、その WP が同じ commit で契約行も変えてよい（行に明記したものだけ）。
- **ストリームの継続（CR m1-120）**: 同じストリームの後続 WP は、先行 WP（終了済み）のディレクトリのうち、この台帳が名指しした修正に限って編集してよい — S5: WP-06b → `packages/gen/src/{orchestrator,prompts,line}/`、S6: WP-08b / WP-08c → `packages/loop/src/{review,router,bundle,contracts}/`、S3: WP-13 → なし（`export/` のみ）。
- 所有の追加: indexer の「誰の所有でもない」部品は CR m1-27・m1-28、CLI daemon は CR m1-9。

| id | requester | 決定 | 適用先 | 理由・備考 |
|---|---|---|---|---|
| CR m1-1 | WP-INT A, WP-06 R3 | accepted-modified | gen `createPromptRenderer(deps: {hasher, secrets, indexer, salt}): PromptRenderer`（`prompts/index.ts`）、`createVerifier(deps: {indexer, anchors, hasher, clock, metrics?}): Verifier & ClaimStamper`（`verify/index.ts`）、`PromptRenderer` に「`render()` は同じ (system id, lang, workdir) で最後に `system()` した system prompt を使う（PT-05）」、`GenDeps.engines` に「無い engine は scheduler 上の gen 内 adapter」 (applied)。`gen/src/index.ts` の暫定 re-export は削除 | 暫定 re-export を正式化。`createSchedulerGenEngine` は内部のまま（`createGen` の fallback が契約の振る舞い）。`genSalt(db, random)` は **rejected**: salt は composition root が持つ安定な workspace 秘密（`srv_meta` の `gen.salt`）で足りる。composition root は doc store 用に自分の Verifier を作る（`wiring/workspace.ts` を切替済み、late-bound stamper を削除） |
| CR m1-2 | WP-INT A, WP-05 #1 | accepted | agent `createUsageLedger(deps: {db, stateWrite, random, clock, log}): UsageLedger`（`ledger/index.ts`）(applied) | 暫定 re-export を正式化 |
| CR m1-3 | WP-INT A, WP-04 | accepted | doc `createHighlight(wasm, cacheBlobs?)`（`render/index.ts`）、`elkLayout(elk, {ir})`（`layout/index.ts`）(applied) | compute Worker と ELK pool adapter の Worker 側の半分。暫定 re-export を正式化 |
| CR m1-4 | WP-INT B, WP-09, WP-01 #4 | accepted-modified | server `ServerDeps` + `version`, `pid`, `userHome`, `port?`, `gateSandbox: EffectiveSettings["gateSandbox"]`, `hardware: HardwareInfo`, `gh?`; `git(info)` の戻りを `GitReader & { close(): Promise<void> }` (applied)。CLI（`apps/cli/src/daemon/server.ts`）と compose の呼び出し側を修正 | 構造的な ServerDepsExt を廃止。`timers` は test 専用の上書きとして compose 内に残す（server の `Timers` は `unref` 付きで core の port と形が違う）。core `GitReader` は変えない（fake が多い）— close は ServerDeps の工場の戻り型で表す |
| CR m1-5 | WP-09, WP-INT B | accepted-modified | server 契約コメント: `createServer` は保持中の健全な daemon があれば `E_CONFLICT {pid, port}`。lock は `@mitori/platform` `acquireLock`（stale 判定込み）で composition root が取り、`startDaemon` は取得済み lock を受ける (applied: コメント)。`LockFilePort` の撤去は WP-09 / WP-INT（server 内部） | `ServerDeps` に lock port を足さない（server は platform を import できる）。WP-09 案の `E_PRECONDITION` ではなく実装済みの `E_CONFLICT` |
| CR m1-6 | WP-INT B | accepted-modified | `assembleAnchoredItems` / `distributeReanchor` の出力は意図して部分的: claim は `checks: Pick<ClaimChecks, "l0"\|"l2">` と完全な cites 配列、thread は新しい code member。own slot で最新の保存状態と merge（l1 維持、`checkedAt` = now、thread anchor = 保存済み anchor + 新 code）(applied: server 契約コメント + `wiring/index.ts` の型) | slot 内で読む保存状態の方が新しい（外で読んだ値を渡すより正しい）。「変わった cite を 1 つでも持つ claim は全 cite を出す」を契約に明記 |
| CR m1-7 | WP-INT B | accepted | server `ServerHandle.render` を削除 (applied) | renderer / layouter の cache（`doc_html`・`doc_layouts`）は workspace DB にあるので workspace ごとに作る。HtmlExporter も workspace ごと（WP-13 → WP-INT が配線） |
| CR m1-8 | WP-INT B | deferred（sha256 repo 対応時、M3） | `ServerDeps.pools.parse(size, objectFormat)` | 今は Worker 既定 sha1。assemble は同期なので、対応時に `objectFormat` を workspace open で先に解決して渡す |
| CR m1-9 | WP-INT（M1 §4） | accepted | 所有: `apps/cli/src/daemon/`（`server.ts`・`run.ts`・`serve.ts`）は WP-11（S9）へ返す。WP-INT は `packages/server/src/{compose.ts,wiring/}` と `test/int/` | 結合中の暫定編集を元の所有者へ |
| CR m1-10 | WP-06 R5, WP-INT C | accepted | gen `GenDeps.fs: FsReader`（必須）(applied)。`wiring/workspace.ts` は明示的に渡す | session ingest / `mitori check` が out/ を読む（GEN-I-055 の lstat） |
| CR m1-11 | WP-INT C | accepted | gen `GenOrchestrator.idle(): Promise<void>`（「`control(pause)` + `idle()` の後は何も書かない」）(applied、実装は既存) | 停止後に task 行を書くバグは S5 の修正（WP-06b、CR m1-120）。composition root は close 前に `idle()` を待つ（今の 3 s 上限待ちを正式化） |
| CR m1-12 | WP-INT C | accepted | gen `GenOrchestrator.runs(page: {limit, cursor?}): Page<GenRun>`（新しい順）(applied、スタブ: `orchestrator/gen.ts`)。実装は WP-06b（`store.runs()` の上）、`GET /ws/:ws/gen/runs` の配線は WP-INT | 今は active run だけを返している |
| CR m1-13 | WP-06 R4 | accepted | gen `GenCallResult.continuations?`, `error?: {code, message, retryable}` (applied) | PT-09 / §8.2。`GenCallResultExt` は WP-06b が外す |
| CR m1-14 | WP-06 R1 | accepted | doc `ASPECT_DEFAULTS[*].audience`（gen の `ASPECT_AUDIENCE` と同値）(applied) | 表を 1 つに。gen は WP-06b が `ASPECT_DEFAULTS` を読むよう切替 |
| CR m1-15 | WP-06 R2 | accepted | gen `GEN_PROMPTS[gen.*].form = "compact"`（12 件）(applied)、`prompts/context.ts` `lineForm` を表どおりに | 挙動は不変（既に compact で検証していた） |
| CR m1-16 | WP-06 R6, R13 | accepted | core `GenTask.cacheKey`（userBytes = 対象自身の現内容を除いた SUBJECT、addendum 版は常に key）、api `PrepInfo.expiresAt`（24 h、drift は task 単位で refuse） (applied: doc コメント) | AC-28 / §8.4.3-3 と実装に合わせる |
| CR m1-17 | WP-06 R7, WP-04 notes | accepted-modified | core `Verdict` コメントを §7.2 に訂正し、**真理値表を core `computeVerdict`（`verdict.ts`）へ移設**、gen `verify/` は re-export (applied)。doc store の verdict 計算は core `computeVerdict` を呼ぶ（WP-04 applies） | gen（L1 fail ⇒ inferred）と doc store（L1 fail ⇒ unsupported）が別の表で食い違っていた。仕様 §7.2 を正とし実装を 1 つに |
| CR m1-18 | WP-06 R8 | deferred（M4、questions prompt と同時、WP-06b） | `DocStore.setQuestions` か `StaticDocInput.questions` | M4 の prompt が来るまで question 行は `gen_outputs` のみ |
| CR m1-19 | WP-06 R9 | deferred（M2） | §6.6 marker / span の共有 golden（`fixtures/golden/claim-spans/`、WP-12）→ 同一と証明できたら core へ | 今は gen の写しで正しく動く |
| CR m1-20 | WP-06 R10 | accepted | `packages/gen/src/prompts/prompts.lock.json` を正とする。JSON schema ファイルは書かない（手書き validator が正本、GEN-U-01x） | gen spec §5.1-1・§6.2 はこの行で読む |
| CR m1-21 | WP-06 R11 | accepted | platform `SAFE_WRITE_RULES`: kind `prep` の `fingerprint` は 0600 (WP-01 applies)。core `SafeWriter` コメント (applied) | 署名は変えない（規則で表す） |
| CR m1-22 | WP-06 R12 | accepted | api `UsageRange += "month"`（daemon の時間帯の暦月）(applied)。ledger の範囲計算は WP-05 applies（今は `month` が all と同じ扱い） | anthropic-api の `monthlyCapUsd`（§8.3） |
| CR m1-23 | WP-02 §1 | accepted | indexer §H `ParseItem.skipContentRules?`、`ParseItemResult` ok + `chars`, `lang`, `grammar`, `skeleton?`、新 `{status:"unreadable", path}` (applied) | Worker が既に送っている形。`parse/protocol.ts` の拡張型は WP-02 が外す |
| CR m1-24 | WP-02 §2, WP-03 A | accepted（WP-INT 適用済み） | `update/later.ts`（`LaterStagesFactory`）、`parse/detectors.ts`（`FACT_DETECTORS`）、WP-03 A の ParseItemResult 規約 1〜5 | パッケージ内の合意。規約は parse Worker が守る |
| CR m1-25 | WP-02 §3, WP-01 #3 | accepted-modified | core `GitReader.checkIgnore?(paths)`（次バッチで必須化）、`lsFiles` の untracked は `blob: ""`/`mode: ""`、`statusDirty` の内訳、SEC-05 の読み取り規則（`GIT_CONFIG_COUNT` env、`GIT_NO_LAZY_FETCH=1`）(applied: core)。実装は WP-01、`update()` での使用は WP-02 | `lsIgnored` は **rejected**: nongit truth の `node_modules/`・`.venv/`・`build/` 行は「列挙しない」が正しい（IDX-AT-05）ので WP-12 が truth から外す |
| CR m1-26 | WP-INT C, WP-10a（S1 strip） | accepted-modified | core `RepoProfile {remote, head{commit,date,tag}, license, toolchain, readme, areas}`・`AreaStat`、api `WorkspaceStatus.profile?`、indexer `Indexer.profile(): RepoProfile \| null`、core `GitReader.remoteUrl?()`・`headMeta?()` (applied)。facade は `null` を返す暫定（`update/facade.ts`）。実装: indexer polish（WP-02 facade + WP-03 `facts/`）、GitReader の 2 メソッドは WP-01、`GET /ws/:ws` への配線は WP-INT（`DomainProviders.status`）、hero / header の表示は WP-10a | プロトタイプ `01-first-run-map` の hero（`github.com/… · Go 1.26 · MIT · 406875d (2026-10-02)`、README 1 行目、規模タイル 4 枚、header の `v0.21.1`）を 0 tok で出す。WP-10a 案の `ScanSummaryView.license` / `snapshot.commitAt` を 1 つの型に統合。表示語（「本体」「テスト」）は UI の i18n |
| CR m1-27 | WP-INT C | accepted | 所有: `skeleton()` の module / repo target（§7.2 の縮退）→ WP-02（`skeleton/`）、`moduleContext`・`hotBodies`・`rationaleComments`（§7.2–7.3・§7.8）→ WP-03（`pack/`）。`update/later.ts` の最小版はそれぞれが置き換える | gen の planner / prompt が呼ぶのに誰の所有でもなかった |
| CR m1-28 | WP-INT C | accepted | incremental S2 → WP-03（`resolve/`・`facts/`）: 変更ファイルの import と、変更された resolver config に依存するファイルだけ再解決、facts は変更ファイル単位で relink | `idx.update.1file`（15 / 30 ms）と crit の `ui.staleBadge` target。契約変更なし |
| CR m1-29 | WP-INT C, WP-01（watcher） | accepted | indexer `FsChange` コメント: 種別はヒント、`update()` は stat と index 所属で決める（既知 path の `add` は `change` で oldBlob 付き、ディレクトリ prefix の `delete` は配下全削除）(applied)。実装 WP-02 | editor の tmp + rename 保存で 1 回目の delta が stale を付けず 2 回目が要った（crit 80–140 ms） |
| CR m1-30 | WP-02 §5 | accepted | indexer `TAGS_QUERIES`（`lang/index.ts`）、`assertProject`・`notProjectReason`（`inventory/index.ts`）(applied) | server の parse Worker entry と open の guard が使う |
| CR m1-31 | WP-02 §4 | accepted | truth: py-small `Repo.__init__` → `constructor`（WP-12）。indexer spec §3.6 の Rust impl 命名は truth（`impl Trait for Type`、member `Type.method`）に合わせる（spec はこの行で読む）。go.scm の `var ( … )` と TS namespace 内 const は deferred（M2、`.scm` と spec を同時に） | CR m0-12 の方針（truth の規約を採る）の延長 |
| CR m1-32 | WP-02 §6 | accepted-modified | schema（`idx_files.raw`・`mtime_us`、`idx_blobs.chars/lang/grammar/note/data`、`idx_symbols.decorators`、`idx_blob_text.bytes` nullable、BLOB は JSON）、pin store GC、timeout parse を保存しない規則を記録。**shadow workspace は background の全文コピーをやめ、`pinBlobs()`（anchor）時だけ本文を保存**（git workspace は R1 §7.7 のまま dirty ファイルのみ）(WP-02 applies) | gostd で 47 MB・0.7 s の複製は RSS / 時間に見合わない。anchor 作成時に捕まえれば次の保存でも旧本文がある |
| CR m1-33 | WP-02 §8, M1 §3 | deferred（M2 の計測窓、WP-12） | gostd cold 2.0 s（limit 1.5）・peak RSS ≈ 1.05 GB（limit 1 GB）、O-IDX-1（`perfCores` 上限か E-core 込みか）の再適合 | 他エージェント稼働中の計測。idle な基準機で測り直してから判断 |
| CR m1-34 | WP-02 §9 | accepted | モデル行きの indexer 出力（`skeleton`・`moduleContext`・`hotBodies`・`flowBodies`・`rationaleComments`・`repoPack`）は bidi / zero-width / BOM を `\u{…}` で可視化（行数不変）。`read()`・`currentText()`・`blobText()` は raw のまま (applied: indexer 契約コメント)。実装 WP-02 / WP-03 | RT-16（Trojan Source）。content address の cache に乗る 1 か所で。UI と loop bundle は自分で escape 済み |
| CR m1-35 | WP-02 §10 | accepted | core `SymbolEntry.signature`（literal を含むとき secret scan）、indexer 契約コメント（`symbolsAt` の除外、`blobText` の最終手段、`""` blob、scan / update の直列化）(applied) | 実装済みの振る舞いを契約に。`skeletonHeader` の 1 行化と `#d<8 hex>` の content key も確定 |
| CR m1-36 | WP-03 B1 | accepted-modified | IDX-AT-31 / MILESTONES WP-03: m3e は「directory 分割より高く、同じグラフで Louvain 50 順序の最良値 × 0.9 以上」(applied: MILESTONES・indexer spec)。crit ≥ 0.45 [仮] は据え置き | 仕様のグラフでは最良 0.191（300 順序）。絶対値 0.2 は到達不能 |
| CR m1-37 | WP-03 B2, B4 | accepted | truth（WP-12）: 辺の無い module 制約（ts-small `repo.ts`/`types.ts`、go-small `store.go`/`memory.go`、py-small 3 件、mixed 2 件）を削除。mixed の tooling 行（`env REPORT_DIR`、`cli indexer build`）は `stretch`、`bin:indexer-rs` を追加 | spec（tooling は `example` scope）と CR m0-12（bin root は `bin:<name>`）が勝つ |
| CR m1-38 | WP-03 B3 | deferred（M3） | `RouteFact.mount?`（合成した prefix、表示のみ） | route key は書かれたまま（truth の規約） |
| CR m1-39 | WP-03 C | accepted | 逸脱の記録（γ 探索、small-leaf merge、identity 照合順、seed 復元、`entry.testmain@1`、`mergeInto` の適用位置、seed の検証）。`STRUCTURE_PARAMS.hysteresis` の調整は deferred（M2、§11.4 replay） | id / slug は安定（IDX-AT-33 最悪 0 %） |
| CR m1-40 | WP-04, WP-INT C | accepted-modified | doc `createDocStore` deps + `fs?: FsReader`, `timers?: Timers \| null`（`store/index.ts`）(applied、実装は既存)、core `Timers` port (applied) | 本番は両方渡す。optional はディスク無しの unit test のため |
| CR m1-41 | WP-04 | accepted | doc `GenIdSource.next` の kind + `"doc"`, `"diagram"` (applied)。`ensureManifest` の docId 派生は WP-04 が置き換え | CONS-11 |
| CR m1-42 | WP-04 | accepted | doc `StaticDocInput.estimates?`（節ごとの in/out）、`largeFiles?`（`s11:large`）(applied)。渡すのは WP-INT（`wiring/static-input.ts`）、store の読み取りは WP-04 | ux-R14 の `SectionNode.est` と 「生成する ≈N tok」 |
| CR m1-43 | WP-04 | accepted | doc `STATIC_SLOTS += "<section>:ph"` (applied) | §1・§3・§9 … の placeholder |
| CR m1-44 | WP-04 | accepted | doc `toMarkerForm(md, lang, ctx?: CodecContext)` (WP-04 applies, `codec/index.ts`) | ctx 無しは href のまま |
| CR m1-45 | WP-04, WP-INT C | accepted | platform `SAFE_WRITE_RULES`: kind `doc` / `prep` は親が realpath なら欠けた `rootReal` を作る (WP-01 applies)。core `SafeWriter` コメント (applied)。その後 WP-INT が `docRootWriter` を外す | 新しい repo には `.mitori/` が無い |
| CR m1-46 | WP-04, WP-INT C | accepted | doc `DocStore.mdLine(id): number \| null` (applied、スタブ: `store/store.ts`)。実装 WP-04、server の導出（`wiring/views.ts`）からの切替は WP-INT | ux-R2 / ux-R15 の `data-ln` |
| CR m1-47 | WP-04 | deferred（M2、glossary と同時） | 用語の初出（`data-first`） | glossary は生成後にしか無い |
| CR m1-48 | WP-04 | accepted | doc `HighlightReq.lang: SourceLang \| "json" \| "yaml" \| "toml" \| "markdown" \| "shellscript" \| "sql"` (WP-04 applies: 契約行と grammar を同時に) | quickstart / 設定の fence |
| CR m1-49 | WP-04 | accepted | `createDocStore` deps + `mitoriVersion: string`（= `ServerDeps.version`）(WP-04 applies) | manifest の `"0.0.0"` をやめる |
| CR m1-50 | WP-04 | accepted | doc `DocStore.stampRun({effort, snapshot, usage, full}): DocManifest` (applied、実装も: `store/store.ts`、usage 累積・full のときだけ `generatedAt`)。呼び出しは gen orchestrator の run 終了 slot（WP-06b、CR m1-120） | 生成後も 「未生成」 と出ていた（AC-29） |
| CR m1-51 | WP-04 | accepted | doc `BlockRenderer.render` opts + `diagram?: {ir, layout?: Pick<DiagramLayout,"width"\|"height">}` (applied)。実装 WP-04、渡すのは WP-INT | `figure.mdiagram[data-w][data-h]`（CLS 0）と node + edge のテキスト代替 |
| CR m1-52 | WP-INT C | accepted | doc `editBlock` コメント: 再 stamp した block の鮮度は新しい stamp から再計算（stale → fresh）(applied)。実装 WP-04 | 人が cite し直しても stale のままだった |
| CR m1-53 | WP-04 findings | deferred（M3、10k block の flush が fsync 込みで 20 ms limit を超えたら） | `doc.index.json` の file 単位 shard（ADR-0004 R1 の改訂を伴う） | M1 の corpus の doc は数百 block。in-memory 2.7–3.5 ms CPU は target 内 |
| CR m1-54 | WP-04 findings | accepted | file 単位の graph view は rank 上位 300 node に制限し、300 超かつ 4 edge/node 超では `crossingMinimization: NONE`。container map は不変 (WP-04 layout / WP-INT views) | 密な実グラフで 300 node 109–126 ms（target 100） |
| CR m1-55 | WP-04 findings | accepted | 提案の cite: 作成時に stamp、accept 時に現 snapshot で再 stamp（L0 fail は提案カードに出す）。pending 中の re-anchor はしない (WP-04) | anchor / loop に新しい配線を足さない |
| CR m1-56 | WP-04 notes | accepted | O8 バイト規則の凍結、GitHub 描画の証拠（`docs/design/specs/assets/wp04-github/`、gen spec §10.2 から参照）、ownership ledger、reload の block 単位 3-way、write queue / event の規則を記録 | — |
| CR m1-57 | WP-05 #2 | accepted | agent `createAgentBridge` deps + `safeWrite: SafeWriter`, `fs: FsReader`, `fetch?`、+ `pin(engine, pin: BinaryPin): Promise<void>`（CR m1-65）(WP-05 applies, `bridge/index.ts`; 契約のポインタコメントは applied) | I3 / I9。WP-INT は構造的に渡し済み |
| CR m1-58 | WP-05 #3 | accepted | agent `BridgePaths.sessionId?` (applied) | I4 |
| CR m1-59 | WP-05 #4 | accepted | agent `createClaudeNormalizer(opts.now?: () => UnixMs)` (WP-05 applies, `normalize/index.ts`) | `JobEvent.at` |
| CR m1-60 | WP-05 #5 | accepted | agent `AnthropicApiRequest.messages[].content[].cache_control?` (applied) | BP3（gen §8.3） |
| CR m1-61 | WP-05 #6 | accepted-modified | agent `UsageLedger.fixedOverhead` の key を定義: `xxh3("<engine>\n<mode>\n<model>\n<promptVer>")` (applied: コメント) | 署名は変えない |
| CR m1-62 | WP-05 #7 | deferred（M2、gen の window_spend バナーと同時） | `AgentScheduler.resume(lane)` | 今は lane が空になれば pause が解ける |
| CR m1-63 | WP-05 #8 | accepted-modified | agent `WarmProfile` コメント: warm 再利用には launch の一致も要る（`sameLaunch` が規範）(applied) | warm pool は stretch（既定 0）。型に `launchHash` は足さない |
| CR m1-64 | WP-05 #9 | deferred（M2 の較正窓） | `kind:*` 較正の source（`calibration()`・`recordKindSample`） | indexer は factor 1.0 |
| CR m1-65 | WP-INT C | accepted-modified | **初回 pin は TOFU**: daemon 起動時に `pins.claude` が無ければ bridge が SAFE_PATH 上の `claude` を解決して pin し（core `BinaryPin.by: "first-run"` (applied)）、`pin()` dep 経由で composition root が settings に保存。engine card は 「初回に固定 · v… · path ［変更］」、以後の差異は従来どおり `E_ENGINE_BINARY_CHANGED`。実装: WP-05（解決）、WP-INT（保存の配線）、WP-10a（card）。settings schema は `by` を受ける (applied) | 「見つかりません」 を 1 クリックも要さずに解消。SAFE_PATH は workspace 配下を除くので repo からは差し込めない（SEC-10） |
| CR m1-66 | WP-05 B | accepted | spec の訂正（この行で読む）: SIGINT 後の `result` は usage 0 ⇒ meter から ledger（`usageEstimated`、loop §6.5.2/§6.7）、normalizer は `aborted_streaming` → `cancelled`、thinking token も meter に数える。CC-03 は `path:"builtin"` plugin を除外。testing §3.3 の fence regex は gen / loop 両形。`--json-schema` は余分な API call を作らない | 契約テスト（claude 2.1.288）の実測 |
| CR m1-67 | WP-05 C, WP-01 #2, CR m0-6 | accepted-modified | fake は各 WP が `@mitori/platform/testing`・`@mitori/agent/testing` を直接使ってよい。testkit `ports/` の re-export は S10（WP-12）。`FakeClock`・`TestLogger`・`FakeSpawner`・`ScriptedChild` 型の platform への移設は deferred（M2 バッチ） | testkit のスタブを待たずに並行作業できる |
| CR m1-68 | WP-07 #1 | accepted-modified | loop `CapturedAnchor`（contract へ移設）、`ReviewEngine.create(req, by, captured?)`・`patch(id, req, captured?)`、`createLoop(...).capture(input, previous): Promise<CapturedAnchor>` (applied: 契約 + `jobs/index.ts` スタブ署名)。server handler は slot の外で `capture` → slot 内で `create` / `patch`。`captured` 無しは engine 自身の同期 port（テスト・本文を持つ呼び出し）。実装 WP-08b | server spec §8（handler が AnchorInput → Anchor）どおり。async な読みを slot に入れない |
| CR m1-69 | WP-07 #2 | accepted | loop `renderReviewStdout` の entry + `bundleTokens?` (WP-08b applies, `review/index.ts`) | UXP-33 ` bundle≈{k}` |
| CR m1-70 | WP-07 #3 | accepted | doc `BlockRenderer.renderMessage(md): string`（同期・cache・secret redaction）(applied、実装も)、loop `LoopDeps.renderMessage` (applied) | ux-R23 の `MessageView.html`。markdown-it 設定を 2 つ持たない |
| CR m1-71 | WP-07 #4, WP-08a A6 | accepted | loop `CHANGE_INTENTS = ["change","doc_edit"]`、`ROUTER_RULES` の intents から `note` を削除、`BatchJobPlan.kind` コメント (applied) | note は書かない（R1 §2.1、UXP-02）。`route()` は R0 / R0b で先に処理済み |
| CR m1-72 | WP-07 #5, #12 | accepted | loop `ReviewEngine` + `status()`, `waiters()`, `shutdown()`, `snapshots(id)`, `summary(id)`, `recordTouched(paths)` (applied。前 5 つは実装済み、`recordTouched` はスタブ: `review/engine.ts`、実装 WP-08b) | `GET /review`、idle 判定、停止時の waiter 解放、re-anchor 入力、touch のファイル |
| CR m1-73 | WP-07 #6 | accepted | loop `JobRunner.create` コメント: Finish が dispatch 済み（`queued` + `batchRound`）の thread には T2 を撃たない (applied) | 二重 dispatch を防ぐ |
| CR m1-74 | WP-07 #7 | accepted | loop spec §2.8 DDL は `rev_threads.send_to_ai`・`rev_rounds.files`・`rev_rounds.done` を含む（この行で読む） | `LOOP_MIGRATIONS` v1 のとおり |
| CR m1-75 | WP-07 #8, #9 | deferred（M3） | 回答の引用から `Decision.cites` を作る stamping port、`[[path:a-b]]` → doc の cite link helper | 今は code member のみ / `[path:a-b](path#La-Lb)` |
| CR m1-76 | WP-07 #10 | deferred（M3、実 round で計測） | 日本語 quote の表示幅（`quoteLabelChars`） | golden round は ≤ 50 token |
| CR m1-77 | WP-07 #11, WP-08a B | accepted | `bench/budgets/anchor.json`・`loop.json` の `measure` は bench file ができるまで既存テスト（`packages/anchor/test/perf/ar7.test.ts`、`packages/loop/src/review/stdout.golden.test.ts`、`packages/loop/test/perf/bundle.perf.test.ts`）を指す（S6 が自分の json を編集） | — |
| CR m1-78 | WP-07 #12 | deferred（M3） | `changedSinceDelivery(paths)`（`reply --files` の 「unchanged」 注記） | delivery snapshot が要る |
| CR m1-79 | WP-07 #13 | accepted | AR2 / AR6 は `packages/anchor/test/regression/`（unit の 500 ms 規則の対象外）へ移し、`anchor.json` の pointer も更新 (WP-07 / S6) | 件数は loop spec §1.9 で固定 |
| CR m1-80 | WP-07 #14 | deferred（CI バッチ、WP-12 A.3 と同時、M2） | PR gate で crit を fetch して AR1 を必須に | corpus fetch の CI 構成をまとめて入れる |
| CR m1-81 | WP-08a A1 | accepted | loop `RouteInput.primary?: "doc"\|"code"\|"diagram"` (applied) | R0b |
| CR m1-82 | WP-08a A2 | accepted | `deriveWriteScope` ctx + `sectionOfBlock?`, `refsOfDiagram?`, `writable?` (WP-08b applies, `router/index.ts`; ctx を作るのも WP-08b) | `writable` は filter / working-tree-encoding / LFS pointer（SEC-18） |
| CR m1-83 | WP-08a A3 | accepted | loop `BundleInput.numbered?` (applied) | `mitori bundle --lines`（WP-11）、MCP |
| CR m1-84 | WP-08a A4 | accepted | `BundleBuilderDeps.readJobFile(job, path)` は内部 deps のまま。WP-08b の `createLoop` が `GitSafety`（worktree / `buildTree`）から供給 | 契約変更なし |
| CR m1-85 | WP-08a A5 | deferred（M3+） | indexer の symbol 単位 call edge（`refsOf`） | REL は最初に落とす部分。heuristic で可 |
| CR m1-86 | WP-08a B | accepted | (a) `planBatch` は route group で分割（question と sent note は別 partition）— WP-08b が `review/` を直す（CR m1-120）。(b) router の `error.params.actions` はカンマ区切り、JobRunner が `JobFailure.actions` へ。(c) rules の trust hash = `sha256(Σ path ␀ text ␀)`（path 順、同一内容は 1 回）を trust card も使う。(d) `loopSystemPrompt` が system prompt file の中身。(e) `contracts/text.ts` の写しを `@mitori/anchor` の import に置換（WP-08b）。(f) `doc_updates[].md` の `[path:a-b]` は WP-08b が `RawCite` に戻して `doc.propose` へ。(g) `E_DENY_GLOB` の actions から `copy_prompt` を外す | 結合の取り決め |
| CR m1-87 | WP-08a C | accepted | MBF/1 as built（C.1〜C.14）を凍結。loop spec §4 はこの行と `fixtures/golden/go-small/bundles/` で読む | — |
| CR m1-88 | WP-01 SEC-05 addendum | accepted | loop `GIT_ENV.GIT_NO_LAZY_FETCH = "1"`、`GIT_COMMAND_CONFIG_PATTERNS` の無効化は `-c` ではなく `GIT_CONFIG_COUNT/KEY/VALUE` env (applied: 契約)。実装 WP-08b | partial clone の遅延 fetch と `a=b` driver の回避 |
| CR m1-89 | WP-09 | accepted | client `probeDaemon(opts)`（`http/index.ts`）(applied) | SEC-06 / SRV-AT-09。WP-11 が使う |
| CR m1-90 | WP-09, CR m0-22 | accepted | core `DEFAULT_LIMITS`（`jobMaxUsd` 2・`genRunMaxUsd` 10・`dailyMaxUsd` 30 [仮] ほか）(applied)。CORE-U-009 の比較は WP-12 | CR m0-22 を解消 |
| CR m1-91 | WP-09 | accepted-modified | server `InboxSources.suggestions` コメント: href は `/w/<ws>/` 相対、route が絶対化 (applied) | 型は変えない |
| CR m1-92 | WP-09 | accepted | client `ApiCallError extends MitoriError { estimate? }` (applied) | CONS-33。WP-10b が読む |
| CR m1-93 | WP-10a | accepted | 初回訪問の言語: daemon が最初の `GET /` で `mitori_ui` cookie（`GlobalSettings.ui.lang`）を set する（WP-09 / S7）。WP-10a の 400 ms 待ちは fallback として残す | CLS 0.0036 を消す |
| CR m1-94 | WP-10a | accepted | `@mitori/client`（WP-09 実装済み）を WP-10a が採用し `shell/net/` の fallback を削除。SSE の gap 判定は hello の前の seq と比べる（client 契約コメント (applied)） | — |
| CR m1-95 | WP-10a | accepted | web `UiExtension`（`views?`, `reviewPanel?`, `margin?`, `install?(stores: AppStores)`）、各 `*/ui.ts` の `default` (applied) | WP-10a ⇄ WP-10b が互いのファイルを触らない |
| CR m1-96 | WP-10a | accepted | web `NUMBER_FORMAT.tokens.mThreshold = 100_000` (applied)、`shell/fmt.ts` の ÷10 を削除 | 仕様の例（`≈0.12M`） |
| CR m1-97 | WP-10a | accepted | web `I18N_RULES.keyPattern` の最後の segment に `-` を許す (applied) | `verdict.human-verified` |
| CR m1-98 | WP-10a | accepted | web `PaletteWorkerReply` results + `counts`, `top` (applied、`palette/worker.ts` 修正)、`PALETTE_SCORING` コメント（via term が当たった symbol は top hit を term に譲る、AC-J46）(applied) | — |
| CR m1-99 | WP-10a | accepted | core `SectionNode.state`（streaming 予約は run 中だけ）、web `KeyConflict`（設計上の優先 2 組）(applied: コメント)。ux spec の訂正（この行で読む）: 翻訳注記は章頭の `§n` 行に置く（§4.3）、toast 表は `§{id} {title} が届きました · 最初の文まで {s} 秒`（§3.5） | — |
| CR m1-100 | WP-10a | accepted | web `CHUNK_NAMES` + `launcher`, `help`、`BUNDLE_BUDGETS.chunksKb` launcher 4・help 3 (applied) | M3 の size gate 前に entry から出す |
| CR m1-101 | WP-10a | accepted | i18n: 各 WP が自分のディレクトリの namespace を所有、`status.*`・`stage.*` は WP-10b の namespace (applied: `I18N_RULES` コメント) | — |
| CR m1-102 | WP-INT C | accepted | `mitori:facts:painted` を WP-10a が出す（`UI_PERF_MARKS` は既に含む） | 契約変更なし |
| CR m1-103 | M1 §5 | accepted | 見た目の決定: (1) 「間取り図にできない構成…」 バナーは floor plan flag が on でゲートに落ちたときだけ（WP-18 off の間は `MapView.fallback` を出さない、WP-INT views）。(2) Reader は doc 自身の章見出し block をページ見出しとして 1 回だけ出す（WP-10a）。(3) hero / header は `WorkspaceStatus.profile`（CR m1-26、WP-10a）。(4) 生成前の 30 分コースは 「0 / 7 · 残り約 30 分」、TOC は見積りがあれば節ごとの ≈k（WP-10a） | プロトタイプとの差を埋める順番 |
| CR m1-104 | WP-12 A1 | accepted | `bunfig.toml [test] preload = ["./packages/testkit/src/preload.ts"]`、`pathIgnorePatterns += "e2e/**/*.spec.ts"` (applied) | CR m0-9 の有効化条件を満たした: 全 2,155 テストが preload 下で緑（2026-10-03、0 fail）。以後、`createTestHome()` を使わず `~/.mitori` を読むテスト、loopback 以外への通信、`claude`/`codex` の起動（`MITORI_LIVE=1` 以外）、未処理 rejection、`console.error` は失敗する（testing spec §1.5） |
| CR m1-105 | WP-12 A2, A3 | deferred（CI バッチ、M2） | `devShells.ci` に playwright-driver / CJK font、workflow `bench-rel`・`e2e-pr`・`bench-abs`・`eval` | 今の PR job は緑。flake 変更は全 worktree の nd cache を作り直す |
| CR m1-106 | WP-12 A4 | deferred（M3 の a11y gate） | testkit devDependency `axe-core`（exact pin、lockfile 更新） | `ui.axe` は無いと `E_UNSUPPORTED` |
| CR m1-107 | WP-12 B | accepted | B.1〜B.13 の決定を維持（Wilson z = 1.645 片側、`minN` 30、size の静的検査、SC-21、machine factor、配置、daemon 起動、`bin.startup`、`bench:compare --asset`、trace category、rate SLO の色、perf project、`agent.spawns.real`、metered eval の上限）。testing spec §7.4 はこの行で読む | — |
| CR m1-108 | WP-12 C1 | accepted | testkit `BudgetEntry.minN?` (applied) | `eval/slo.ts` の cast は WP-12 が外す |
| CR m1-109 | WP-12 C2, C3 | accepted | testkit `TestHome.env` は上書き分だけ（`process.env` に重ねる）(applied: コメント)。`PageLike` は変えない（実行時に絞る） | — |
| CR m1-110 | WP-01 #1 | accepted | platform の公開面 56 名（各 sub-directory）を記録。agent / server / indexer の構造的コピーは re-export しない | — |
| CR m1-111 | WP-01 #4 | accepted-modified | = CR m1-4（`ServerDeps.git` の戻りに `close()`） | core `GitReader` は不変 |
| CR m1-112 | WP-01 #5 | accepted | migration runner と sqlite は platform の 1 実装（`runMigrations`・`openSqlDb`）。`apps/cli/src/daemon/{migrate,sqlite}.ts` は WP-11 が削除 | 名前付き param の厳密さが違う |
| CR m1-113 | WP-01 #6 | accepted | `bench/budgets/platform.json`（`plat.git.lsFiles` 20 ms、`plat.watch.latency` 25 / 50 ms、`plat.watch.setup` ≤ 500 ms、`plat.safeWrite`）を WP-01 が追加し `budgets:merge` | MILESTONES WP-01 の数値に id を付ける |
| CR m1-114 | WP-01 #7 | accepted | indexer spec §10.1 の読み替え（この行で読む）: watcher bench は `packages/platform/bench/watch.bench.ts`、記録は `docs/design/specs/platform-watch.md`、O3 は候補 A で決定 | — |
| CR m1-115 | WP-01 SEC-05 | accepted | GitReader の読み取り hardening（filter driver 無効化、`GIT_NO_LAZY_FETCH`、`protocol.allow=never`、include / worktree の cache key）を記録。core コメントは CR m1-25、loop 側は CR m1-88 | — |
| CR m1-116 | WP-INT C | accepted | core `HardwareInfo`（indexer から移設、indexer は re-export）(applied)、platform `hardwareInfo(): HardwareInfo`（同期、`sysctl -n hw.perflevel0.logicalcpu` を 1 回）(WP-01 applies)、`ServerDeps.hardware` (applied) | parse pool の上限が P-core 数で決まる。CLI は WP-01 の関数ができるまで `perfCores: null` |
| CR m1-117 | WP-INT C | accepted | testing spec §7: darwin の `srv.rss.*` / `idx.rss.idle` は `phys_footprint` で測る（この行で読む、WP-12 の測定器） | ps RSS は解放済み Worker page を数える（crit 689 MB vs 93 MB） |
| CR m1-118 | WP-INT B | accepted | server `WorkspaceManager.update(ws, patch: Partial<Pick<WorkspaceInfo,"docDir"\|"docCommitted">>)` (applied、実装も: `ws/manager.ts`)。compose の `init` は WP-INT が `update` に置き換え | `POST /ws/:ws/init {commit:true}` |
| CR m1-119 | WP-INT B | accepted | platform `detectGateSandbox(): "sandbox-exec" \| "bwrap" \| "none"`（macOS は sandbox-exec、Linux は bwrap の有無）(WP-01 applies)、CLI が `ServerDeps.gateSandbox` に渡す（それまで `"none"`）(WP-11) | WP-08c の test gate（RT-30）が要る |
| CR m1-120 | architect | accepted | ストリームの継続（上の規則）: S5 は WP-06b が `gen/src/{orchestrator,prompts,line}/` の CR m1-11・m1-12・m1-13・m1-14・m1-50 と停止後書き込みのバグ、S6 は WP-08b / WP-08c が `loop/src/{review,router,bundle,contracts}/` の CR m1-68・m1-69・m1-72・m1-82・m1-86 を直してよい | 先行 WP は終了済み。並行トラックの待ちを作らない |
| CR m1-121 | WP-09（M1 §4） | accepted | api `SettingsView.lastError?: MitoriErrorData`（人が編集した `config.json` を適用できなかった理由、直前の正しい設定が有効のまま）(applied)。`GET /settings` で返すのは WP-09 / S7（settings service の `lastError()` は実装済み）、表示は WP-10a | 設定ファイルの誤りが黙って無視されていた |

## 6. 仕上げパス — ux トラック（2026-10-04、`docs/progress/ux.md`）

| id | requester | 決定 | 適用先 | 理由・備考 |
|---|---|---|---|---|
| CR ux-F1 | ux（仕上げ） | accepted | api `CodeTargetsReq`・`CodeTarget`・`CodeTargets`、route `POST /ws/:ws/jobs/targets`（`mutates: false`、owner loop）(applied)。実装は loop `review/targets.ts`（`resolveCodeTargets`、純関数）+ server `wiring/loop-routes.ts` | 設計書の文へのコメントから、ファイル名を知らなくても Fix が書ける（コンセプトの中心）。出典（claim の cite）は自動の対象コード、出典の無い文は表の行・文の参照（バッククォートのシンボル名を含む）・シンボル名・全文検索・同じ節の近くの文の出典（`source: "near"`、検証パスで追加）の候補をユーザーが 1 クリックで選ぶ（黙って推測して書かない）。`ReviewEngine` のメソッドにはしていない（cr-requests/ux.md #1） |
| CR ux-F2 | ux（仕上げ、= WP-11 #3） | accepted | loop `INTEGRATION_TEMPLATES`（文面のみ、id は `@1` のまま — daemon の install route は今回まで 501 で、配布済みの block は無い）: `agents-md/block@1` を markers 込み 74 tok に短縮（「Run `mitori review` only when asked; reply via `mitori reply`. Never edit `{docDir}/` except prep `out/` files.」）、review SKILL.md step 1 を短縮（plugin 1,480 B / project 1,487 B / codex 1,305 B ≤ 1,500 B）、`marketplace.json@1` に `metadata.description`（`claude plugin validate` の警告を解消）(applied)。server: `createInstaller` を compose に、`GET /integrations`・`POST /integrations/:target/install`（`wiring/integrations.ts`）、`POST /ws/:ws/init {agentsBlock}` | `install.agentsTokens`（limit 80）と `install.skillBytes`（limit 1,500 B）を満たす。`test.failing` を外した |

## 7. 監査の仕上げ — finisher（2026-10-04、`docs/progress/audit-resolution.md`）

| id | requester | 決定 | 適用先 | 理由・備考 |
|---|---|---|---|---|
| CR fin-1 | finisher（EX-01） | accepted | core `DocModuleEntry.members?: RepoPath[]`（葉モジュールの全メンバー、path 順。省略可 = 旧 doc.index.json）、`NOTICE_KEYS` に `notice.doc.moduleReattached` / `notice.doc.moduleOrphaned`、indexer `ModuleSeed.members?`、platform SafeWriter `doc` の許可に `orphaned/<slug>.md` (applied) | 新しいパス・新しい home で開くと分割が変わり、生成済み module 章 16 のうち 14 がスタブで上書きされた（親モジュールの id 変更が子の節まで削除していた）。seed に全メンバーを載せて分割をそのまま復元し、消えたモジュールの頁は重なり（≥ 0.6）で新しい id に付け替えるか `orphaned/` に残す |
| CR fin-2 | finisher（EX-06） | accepted | api `JobReq.docFix?: boolean`（`kind: "explain"` のみ: 答えの最後の ```mitori-doc``` を、アンカーしたブロックの更新提案にする）(applied)。loop `ACCEPT_FIXED.docFix` / `DOC_FIX_FENCE`、web の 3 択（コードを直す / AI に設計書を直させる / 自分で直す） | 「設計書が間違っていてコードが正しい」に AI の道が無かった |
| CR fin-3 | finisher（NC-07 / NC-04） | accepted | api `FileContent.outline?`（300 行超のファイルのトップレベルのシンボル）、`MapView.modules[].summary?`（生成済みのモジュールの一行の役割）(applied) | 4,300 行のハブに目次が無い / 部屋の popover が export 名しか出さない |
| CR fin-4 | finisher（NC-12） | accepted | core `DOC_TEMPLATE` s2 `titleJa`: 見取り図 → 間取り図（製品名と図の名前を分ける。ファイル名 `doc/02-floor-plan.md` は不変）(applied) | 「見取り図」が 3 つの別物を指していた |
| CR fin-5 | finisher（NC-06 / NC-07） | accepted | doc `StaticDocInput.guide?: StaticGuide`（§4 の手順・§5 の読む順番。server が索引から作る、0 tok）(applied、doc の契約) | 「どう動かすか」「どこから読むか」に静的節が答えていなかった |

## 8. 残課題 — safety トラック（2026-10-04、`rem/safety`、`docs/progress/rem-safety.md`）

| id | requester | 決定 | 適用先 | 理由・備考 |
|---|---|---|---|---|
| CR safe-1 | safety（agent.md #8、ADR-0013 R2） | accepted | loop `SandboxPaths.loopback?: LoopbackPolicy`、`GateRunnerDeps.loopbackListeners?`（テスト用の差し替え）、`parseNetstatListeners` / `parseLsofListeners` / `mergeListeners`、`ALWAYS_DENIED_LOOPBACK_PORTS`、`DENIED_MACH_SERVICES`、`HIDDEN_SOCKET_DIRS/FILES`。platform `SEATBELT_PROBE_PROFILE`（`detectGateSandbox` が使う構文を全部確かめる。非公開名）、Linux の検出に `--unshare-net` (applied) | gate は自分のループバックだけを使える（`httptest` 系のテストが通る）。daemon・事前のリスナー・特権ポート・外部・DNS は拒否、daemon のポートが一覧に無ければ全部拒否（fail closed）。同時に unix socket・keychain・LaunchServices などの穴も閉じた。決定と trade-off は ADR-0013 R2 |
| CR safe-2 | safety（agent.md #3） | accepted | core `FsStat.ctimeNs?: bigint`（省略可、lstat の ctime）、platform `lstatOrNull` が設定 (applied、platform `fs/reader.ts` は WP-01 所有: 1 行の追加) | RT-31 の依存ツリーの指紋が、size と mtime を `utimes` で戻した書き換えを見逃していた。省略可にしたのは 23 か所の fake を壊さないため |
| CR safe-3 | safety（F1 の残り） | accepted | loop `GitSafety.linkDependencies(job)` / `unlinkDependencies(job)` (applied)。worktree 作成時、外を指す追跡済み symlink は skip-worktree（`checkout-index -a` が作らない、head commit は元の entry を保つ）。agent mode は依存リンク無しでワークツリーを作り、ゲートの直前にリンクし、各ターンの前に外す。書き込み範囲が追跡済み symlink を通るなら（実体化していなくても）`E_SCOPE_VIOLATION` | agent の Read が `node_modules/../.env`（利用者の `.env`）や `creds -> ~/.aws/credentials` を辿れた。INT-08 と git.int で確認 |
| CR safe-4 | safety（F9） | accepted | loop `GateDetector.detect` の入力に `binaryInfo?(abs)` と `readdir?(abs)`、`GATE_LOCAL_BINARIES` (applied) | repo 内の formatter の信頼 hash に実体（realpath + bytes の sha256）を含める。biome は native build を直接実行、launcher だけなら `executesRepoCode: true`。`.venv` の console-script launcher（black）も同様 |
| CR safe-5 | safety（F8） | accepted | loop `GitSafety.markRound` / `roundChanges` / `undoRound`、`ReviewEngine.roundScope` / `noteRoundChanges`。api `RoundChanges`・`RoundUndoRes`、route `GET /ws/:ws/review/rounds/:n/changes`（mutates: false）・`POST /ws/:ws/review/rounds/:n/undo`（mutates: true）、server `ROUTE_OWNERS` に 2 行（server 契約: WP-09 所有、additive）(applied) | 自分のエージェント（⤴）の経路に範囲チェックと Undo が無かった。ラウンドの基点はサイドリポの ref、Undo は通常の accept（未コミット・divergence 検査・チェックポイントから再適用可）。web の表示は未（rem-safety.md） |
| CR safe-6 | safety（ux.md #2 / #6） | accepted | core `Thread.context?: ThreadContext`、`ThreadContext`、`THREAD_CONTEXT_LIMITS`、api `CreateThreadReq.context?`・`PatchThreadReq.context?`（null で消す）・`CopyPromptReq.context?`、`ContextAdjust.remove` の `write:<path>`。loop migration v3（`rev_threads.context`）(applied) | 選んだ候補と `@` が push の job にしか届かず、⤴ / ⧉ では `WRITE -` だった。出典の自動の対象を WRITE から外す手段も無かった。Composer の送信・× の表示は web 側の残り（rem-safety.md） |
| CR safe-7 | safety（検証パス、ADR-0013 R2 の検証） | accepted | platform `RunOptions.reapGroup?: boolean`（`spawn/spawner.ts` は WP-01 所有: 省略可の 1 項目と 1 行、既定の挙動は不変）。loop の gate runner が `true` で呼ぶ (applied)。同じパスの loop / platform sandbox の所有内の変更: `SandboxPaths.isDir?` / `realpath?`、`SENSITIVE_HOME_DIRS` / `SENSITIVE_HOME_FILES`、`HIDDEN_SOCKET_DIRS` に systemd-resolved・nscd・avahi、platform `BWRAP_PROBE_ARGS`（検出 = gate と同じ形、非公開名）、loop `escapingOnDisk`（agent の各ターンの前） | gate が始めたバックグラウンドのプロセスが gate の後も木に symlink を置けた（次のターンの Read が辿る）。Linux は `~/.claude.json` で全 gate が失敗、コンテナでは検出が誤って bwrap を選んでいた。認証情報のファイルと symlink 先の秘密が gate から読めた。回帰テストは ADR-0013「R2 の検証パス」 |

### 8.1 §7 と他トラックの所有者外の編集のレビュー（rem/safety、loop の所有者として）

| id | requester | 決定 | 対象 | 判断 |
|---|---|---|---|---|
| review fin-1 | rem/safety | accepted | CR fin-1（EX-01: `DocModuleEntry.members`、`orphaned/<slug>.md`） | 維持。SafeWriter の `orphaned/` は `SLUG` の 1 段だけを許し、`..`・多段は fs.test が拒否を確かめている |
| review fin-2 | rem/safety | accepted | CR fin-2（EX-06: `JobReq.docFix`、`DOC_FIX_FENCE`） | 維持（loop 側も確認）。answer モードはコードを書かない。fence の中身は `doc.propose` を通るので SEC-11 の検査が効く。答えから fence は必ず外れる |
| review fin-3 | rem/safety | accepted | CR fin-3（`FileContent.outline`、`MapView.modules[].summary`） | 維持。読み取りのみ・省略可 |
| review fin-4 | rem/safety | accepted | CR fin-4（`DOC_TEMPLATE` s2 の和名） | 維持。表示名だけでファイル名は不変 |
| review fin-5 | rem/safety | accepted | CR fin-5（`StaticDocInput.guide`） | 維持。0 tok の静的節。README の URL・コマンドは文字列として描画されるだけ |
| review agent-4 | rem/safety | accepted | agent.md #4（`jobs/runner.ts`・`assemble.ts`・`store.ts`、`git/side.ts` の `inWorktree` の GIT_DIR / GIT_WORK_TREE 固定と `worktreeAdmin`） | 維持。`<wt>/.git` を書き換えられても mitori の git は外へ出ない（両方向の照合）。今回の変更（symlink・依存リンク・worktree 上限）もこの前提の上にある |
| review ux-4 | rem/safety | accepted-modified | ux.md #4（`workspace.ts` の提案 SSE、web `pendingInserts`、`ROUTE_OWNERS` の jobs/targets、Header、doc の placeholder 修正、`CodeTarget.source "near"`、`decorateTable`、静的更新の提案の配信） | loop / server 契約に関わる部分は維持。1 点だけ挙動を変えた: 静的な facts ブロックへの AI の編集提案は、コードの採用で閉じる（行がコードから再導出されると 409 の行き止まりになっていた。CR safe-6 の項、`ux.test.ts` / `proposal-close.test.ts` を更新）。web / doc のファイルはこのトラックの所有外で、読んだだけ |
