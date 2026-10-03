# contracts/CR-LEDGER.md — 契約変更要求（CR）の台帳

- 版: R1（2026-10-03、レビュー反映パス） / 所有: lead architect
- 目的: ドメイン spec が出した core / api / 他契約への変更要求を **1 行 1 件**で精算する（CONS-01 / SC-01）。WP-00a はこの台帳が「全行 decided」であることを確認してから契約を凍結する。
- 規則
  1. spec に CR を書いたら、同じ PR でこの台帳に行を足す（`scripts/check-cr-ledger.ts` が spec 中の `CR-n` / `Cn` / `Rn` / `§14.3-n` 表記を拾い、台帳に無ければ CI を落とす）。
  2. 決定は `accepted`（適用済み）/ `accepted-modified`（意図は採用、形を変えた）/ `deferred`（理由と目標 M を書く）/ `rejected`（理由）の 4 つ。
  3. 凍結後（M0 以降）の変更は **週 1 回のバッチ PR**（ラベル `contract-change`）。architect は 48 時間以内に採否を返す（SC-01）。
  4. 「適用先」は R1 で変更したファイルと型名。`tsc@6.0.3` 一括検査（core/api/indexer/gen/loop/ui/server の 7 ファイル）で 0 エラー。

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
