# WP-08a — requests found while implementing bundle · router · output contracts

> **Answered in CR batch 2 (2026-10-03)** — decisions in `packages/core/CR-LEDGER.md` §5 (CR m1-1 … CR m1-121). Append new requests below this line.

Everything below has a working default in the tree (`// CR-PENDING(WP-08a)` marks the places); none blocks a
WP-08a acceptance test. The architect decides whether to keep the default or change the contract.

## A. Contract gaps (signature or shape)

## `RouteInput` cannot tell a doc-primary note from a code-primary one (R0b)
- contract: `packages/loop/src/contract.ts` — `RouteInput`
- change: `primary?: "doc" | "code" | "diagram";` (the anchor member the thread was written on; for a batch, the common one)
- why: R0b routes a sent note by its primary member (doc ⇒ `docpatch/1` proposal only, code ⇒ `answer/1`). The router has
  only `codeAnchored`, and a doc-primary note with cited claims is code-anchored too.
- workaround in place: `route()` takes `RouteInput & { primary?: … }` (`router/route.ts`, `RouteInputExt`); without it
  a note with no anchored code (`anchoredLines = 0`) ⇒ `docpatch/1`, otherwise `answer/1` (a note never has a write
  scope of its own, so `codeAnchored` is false for it — see C.11). The decision for a docpatch note is `mode: "answer"`,
  `contract: "docpatch/1"`, model key `rewrite`, tools `none` (`ExecMode` has no docpatch value).
- urgency: nice to have (the fallback is right except for a note on a doc block that has cited claims).

## `deriveWriteScope` ctx: section of a block, diagram nodes, unwritable files
- contract: `packages/loop/src/router/index.ts` stub signature — the `ctx` parameter
- change: add to `ctx`
  ```ts
  sectionOfBlock(block: BlockId): SectionId | null;      // doc_edit "no cites ⇒ the s6 module's files" (spec §3.3)
  refsOfDiagram(a: DiagramAnchor): { path: RepoPath; start?: LineNo; end?: LineNo; module?: ModuleId }[]; // §3.2 diagram-primary
  writable(path: RepoPath): boolean;                      // filter / working-tree-encoding attribute, LFS pointer (SEC-18)
  ```
- why: the contract's ctx has `moduleFilesOfSection(section)` but nothing yields the section of the anchored block, nor
  follows a diagram node's `ref`, nor says which paths git treats specially.
- workaround in place: `sectionOfBlock?` is an optional ctx member (`router/scope.ts`, `ScopeCtx`); without it the fallback
  yields an empty scope. Diagram-primary anchors use `anchor.code` when the server derived one. Unwritable = `FileEntry.excluded`
  in `{binary, secret, deny_glob, special, oversize, minified, data_large, gitignored}` — the indexer/GitSafety must mark
  filter-attribute and LFS-pointer paths as `special` for SEC-18 to hold.
- urgency: nice to have.

## `BundleInput`: line numbers for pull bundles
- contract: `packages/loop/src/contract.ts` — `BundleInput`
- change: `numbered?: boolean;` (`mitori bundle --lines` / `?lines=1`: `N|` instead of `|`; default per mode: answer/findings/patch/copy numbered, agent/pull not)
- why: spec §4.7 makes pull line numbers optional but `BundleInput` has no field for it.
- workaround in place: `build(input: BundleInput & { numbered?: boolean })` (`bundle/build.ts`, `BundleInputExt`).
- urgency: needed by WP-11 (`mitori bundle --lines`) and the MCP `mitori_get_bundle` tool.

## `BundleBuilder.repair` has no file text
- contract: `packages/loop/src/contract.ts` — `BundleBuilder.repair`
- why: a REPAIR turn quotes the CURRENT text of the edited ranges as the job's worktree has it (spec §6.6.3); the input carries
  `ranges` only and the indexer reads the user's tree.
- workaround in place: `BundleBuilderDeps.readJobFile(job, path) → { text, blob } | null` (`bundle/deps.ts`); WP-08b's
  `createLoop` supplies it from `GitSafety` (worktree or `buildTree`). Without it a patch-contract REPAIR carries the failure but no CODE.
- urgency: needed by WP-08b (repair loop).

## Indexer has no symbol-level call edges (REL)
- contract: `packages/indexer/src/contract.ts` — `Indexer`
- change: e.g. `refsOf(key: SymbolKey): { callers: { symbol: SymbolEntry; weight: number }[]; callees: { symbol: SymbolEntry; weight: number }[] }`
- why: REL is "callers / callees of the anchor's symbol by ref-edge weight" (spec §4.3). Today only file-level `imports` /
  `dependents` exist.
- workaround in place: `bundle/rel.ts` derives them — callees = defined or imported symbols whose names occur in the anchored
  text; callers = symbols of the same file and of the top-3 dependents whose body mentions the anchor symbol's name (≤ 6 file reads).
  REL is the first thing dropped, so a heuristic is acceptable; an index-backed version would be cheaper and exact.
- urgency: nice to have.

## `CHANGE_INTENTS` / `ROUTER_RULES` still list `note`
- contract: `packages/loop/src/contract.ts` — `CHANGE_INTENTS`, `ROUTER_RULES`
- change: drop `"note"` from `CHANGE_INTENTS` and from the `intents` of R1/R2/R5/R6 (loop spec R1 §2.1, UXP-02)
- workaround in place: `route()` handles `{note}` before the table (R0 / R0b), so notes never reach R1–R6. `ROUTER_RULES`
  is still the single source of the table; the `note` entries are dead data.
- urgency: cosmetic.

## B. Cross-WP couplings to confirm

- **planBatch (WP-07) must partition by route group, not only by `INTENT_JOB_KIND`.** `question` and `note` are both
  `explain` jobs, but the router treats `{question}` (R3) and `{note}` (R0b) differently and rejects a mix with
  `E_INVALID_INPUT` (R8). A Finish with a question and a sent note must therefore produce two partitions.
- **Router errors carry the suggested actions in `error.params.actions`** as a comma-separated string
  (`narrow_scope`, `copy_prompt`, `other_engine`): `MitoriErrorData.params` holds primitives only. The job runner (WP-08b)
  maps them to `JobFailure.actions`.
- **Trust hash of rule files.** `TrustRecord.item = "rules"` needs a canonical content hash. The bundle builder computes
  `sha256(Σ path ␀ text ␀)` over the rule files it would use, sorted by path (after de-duplicating identical contents,
  i.e. a `CLAUDE.md → AGENTS.md` symlink counts once), and asks `deps.trust("rules", hash)`. The server's trust card
  (WP-09) should show/record exactly this hash (`bundle/build.ts`, "rules" block).
- **System prompt file** (PT-20): `loopSystemPrompt(id, { cwd, deny })` in `@mitori/loop` is the content of that file —
  `LOOP_PROMPTS[id].text` with `{cwd}`, then `DENY <sorted globs>`, then (patch / agent) the two fixed ACCEPT bullets.
  The bridge (WP-05) names the file by its hash.
- **anchor helpers.** `contracts/text.ts` keeps byte-equal copies of `@mitori/anchor`'s `splitLines` / `normLine` /
  `snippetText` (the M0 stubs throw). Swap for the anchor imports when WP-07 lands; `apply.test.ts` pins the behaviour.
- **`BundleBuilderDeps.doc` includes `markerForm`.** DOC text is the block's marker form with each claim's live cites
  (C.12); WP-08b passes the `DocStore`, which has it. Without a marker form the builder converts `block().md` itself.
- **`doc_updates[].md` will carry the DOC cite tokens.** The model sees cites as `[path:a-b]` (C.12) and writes its new
  block text in the same style, so the proposal path (WP-08b with the doc store's `AiMarkdownValidator`, SEC-11) must
  turn `[path:a-b]` back into cite links / claims, or the patch prompt must say how to cite; today neither is specified.
- **`E_DENY_GLOB` suggests `copy_prompt` (spec §3.3), but `copyPrompt` refuses the same anchor** (`E_DENY_GLOB`): a
  copy prompt can carry none of the denied file and its DENY line names it, so it would not help. The architect should
  drop `copy_prompt` from that error's actions (or say what the copy should contain); the router keeps the spec's list.
- **`bench/loop.bench.ts#bundle:M`** (budgets.json `loop.bundle`) does not exist yet — the bench runner is WP-12's. The same
  measurement runs as `packages/loop/test/perf/bundle.perf.test.ts` (p95 ≈ 0.3 ms over in-memory index fakes; ≤ 100 ms asserted).

## C. MBF/1 as built (frozen with this WP) — spec text to fold into loop.md §4

Where §4.1–§4.7 and revision R1 left room, the builder (and its goldens, `fixtures/golden/go-small/bundles/`) fixed these:

1. **R1 placement.** Engine modes (answer / findings / patch / agent) emit no `DENY` and no fixed ACCEPT bullets (both are in
   the system prompt file); an `ACCEPT` block appears only for task-specific bullets (`GATE checks pass: <trusted ids>.` for
   patch/agent with trusted gates; the doc_edit bullet). `copy` is self-contained: `DENY`, full `ACCEPT`, `DO`, no `GATE`.
   `pull`: no `DENY`, no `GATE`, no fixed ACCEPT (the skill states them), `DO` always, the doc_edit bullet when needed.
2. **`GATE`** lists the trusted ids; when none is trusted, all ids followed by ` (untrusted)`.
3. **Header** always carries `lang=` (`repo.docLang ?? defaultDocLang`). Copy-as-prompt starts with the fixed preface line.
4. **Batch:** `ASK <id>` per thread only when there is more than one; a doc block shown by an earlier TASK is not repeated
   (`DOC … h=…` followed by `> (same as above)`); CODE ranges of all threads merge per file.
5. **CODE:** the context is the enclosing symbol when it has ≤ 120 lines, else ±20 lines (clamped); levels of the drop
   ladder are the symbol/±20 → ±10 → ±5 → 0 clipped to what was loaded; a block whose spans stop touching splits into several
   CODE blocks. `sym=` is the enclosing symbol's qualified name, `anchor=` the merged anchored ranges (`a-b`, single line `a`).
   Over `bundleMaxTokens`, agent mode prints reference blocks (`CODE path:a-b base=… anchor=… (read with Read)`, no body lines).
6. **REL** entries: `REL path:line sym=<qualname> calledby=<anchor symbol>` (the anchor's symbol uses it) or `calls=<anchor symbol>`
   (it uses the anchor's symbol), followed by one `|signature` line; `needs_more_context` hints are REL blocks with up to 30 plain
   code lines, placed first and dropped last. REL/RULES exist only where a write scope exists. An anchor that spans several
   definitions stands for its (≤ 3) largest callable symbols.
7. **OMITTED** counts: REL = entries, RULES = 1 (shrunk or gone), DOC_NEIGHBORS = lines, THREAD_OLD = messages, CODE_CONTEXT =
   lines; `RULES=untrusted` replaces the RULES count when the rule files were not trusted.
8. **Budget:** when the mandatory parts exceed the asked budget the budget is raised to exactly what they need (≤
   `bundleMaxTokens`), so every optional part is dropped — a deliberate refinement of §4.4 step 1, which would keep optional
   parts up to the maximum. Above the maximum: `overBudget` (patch/agent/pull/copy) or `E_PAYLOAD_TOO_LARGE` (answer/findings).
   Pull bundles start from the tier (question/note XS 800, small change S 1,500) and are capped by the caller's budget (4,000).
9. **Text safety:** every data line is capped at 500 characters except the human's ASK (verbatim); bidi/zero-width characters,
   C0 controls and the Unicode line breaks NEL / U+2028 / U+2029 (line ends to Python `splitlines` and JS `/^/m`) are visible
   escapes everywhere; values in tag lines (paths, symbols, globs, labels, titles) have all control characters and line breaks
   escaped, so no value can start a line. Secret scanning also covers the human's ASK, every code line and REL signatures
   (the indexer already scans what it reads); a repair turn scans its CODE as one text (a PEM block spans lines).
10. **ASK** is the latest human message; `THREAD` shows the newest four earlier non-system messages oldest-first (agent text cut
    at 400 characters), `shown/total` counting messages before the ASK. A thread without a human message (a findings draft
    submitted as is) gets `ASK` + `>`, so the block keeps its one quote line.
11. **Notes never write** (R1, UXP-02): `deriveWriteScope` gives a note context ranges but no path (chips add none), and a
    notes-only bundle prints `WRITE -` with no RULES/REL whatever `write` the caller passes — the pull AC "コード書込 0".
12. **DOC cites** are the claims' cites, not the file-form links: the block's marker form (`DocStore.markerForm`) with marker n
    replaced by claim n's cites as `[path:a-b]` (single line `[path:a]`), the language's inferred label (`（推測）` /
    ` (inferred)`) for a claim without cites. File-form hrefs are relative to the doc file (`../../internal/x.go#L4-L9`) and
    their numbers date from the last cite flush (PT-11); the claims give repo paths at the lines the CODE blocks show.
13. **Output contracts:** a patch/1 insert (end omitted or `< start`) must have `first_line: ""` (§5.1) — a non-empty one is a
    replacement that lost its `end`, which would otherwise duplicate code; `applyEditsToText` still checks replacements only
    (§5.2-3). A repair nonce that occurs in the message is drawn again, as for bundles.
14. **Batch hygiene:** a bundle needs ≥ 1 thread (`E_INVALID_INPUT`); WRITE lists each path once; a hint with `end < start`
    shows its start line, a hint at line 0 is ignored.
