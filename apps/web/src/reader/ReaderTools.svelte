<!-- First-use Reader tools: popovers and document operations; the page keeps its initial keyboard/selection handlers. -->
<script lang="ts">
import {
  type BlockHistoryEntry,
  type BlockId,
  type BlockOpRes,
  type CitePeek as CitePeekData,
  type DocLang,
  type GenRunId,
  HREFS,
  MitoriError,
  type ReaderLevel,
  type SectionId,
  type WorkspaceKey,
} from "@mitori/core";
import { onDestroy, untrack } from "svelte";
import { loadExtensions } from "../shell/ext.ts";
import { errorText, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { editorUrl, factPeek, parseCite } from "./code.ts";
import type { PageModel } from "./page.ts";
import { BlockHistory, CitePeek, ClaimPopover, PeekVerify, TermCard } from "./pop.ts";

let {
  model,
  main,
  ws,
  level,
  oncompose,
  onleaveCode,
}: {
  model: PageModel | null;
  main: HTMLElement | undefined;
  ws: WorkspaceKey | null;
  level: ReaderLevel;
  oncompose: (intent: "note" | "question" | "change", block: BlockId | null, claim: string | null) => void;
  onleaveCode: () => void;
} = $props();
const s = useStores();
const route = $derived(s.router.route);
export function operationBusy() {
  return opBusy || translation !== null;
}
onDestroy(() => closePops(null));

// ---------------------------------------------------------------- cite peek / term card / claim popover
let peek = $state.raw<{ data: CitePeekData; anchorEl: HTMLElement; claimEl: HTMLElement | null; pinned: boolean } | null>(null);
let peekHover = false;
let peekTimer: ReturnType<typeof setTimeout> | null = null;
const peekCache = new Map<string, Promise<CitePeekData>>();
// a static fact's peek is the CURRENT file window: an accept / Undo (SSE index.changed) makes it old (EX-08)
$effect(() => {
  const ch = s.workspace.changed;
  if (!ch) return;
  untrack(() => {
    for (const key of [...peekCache.keys()]) if (key.endsWith("@") && ch.paths.some((p) => key.startsWith(`${p}:`))) peekCache.delete(key);
  });
});
const peeked = new Set<string>();

function fetchPeek(cite: string, blob: string): Promise<CitePeekData> | null {
  const c = parseCite(cite);
  if (!c || !ws) return null;
  const key = `${cite}@${blob}`;
  let p = peekCache.get(key);
  if (!p) {
    // a static fact cite has no claim (no blob): the current file range, highlighted, stands in for the peek
    p = blob
      ? s.api.call("GET /ws/:ws/cite", { params: { ws }, query: { path: c.path, start: c.start, end: c.end, blob, ctx: 3 } })
      : s.api
          .call("GET /ws/:ws/files/content", { params: { ws }, query: { path: c.path, start: Math.max(1, c.start - 3), end: c.end + 3, html: "1" } })
          .then((f) => factPeek(f, c));
    p.catch(() => peekCache.delete(key));
    peekCache.set(key, p);
    if (peekCache.size > 100) peekCache.delete(peekCache.keys().next().value as string);
  }
  return p;
}

function closePeekSoon() {
  if (peekTimer) clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (!peekHover && !peek?.pinned) closePeek();
  }, 160);
}
let peekRequest = 0;
function closePeek() {
  peekRequest++;
  peek = null;
  s.layers.drop("peek");
  main?.querySelector("a.mcite.on")?.classList.remove("on");
}

export function onCite(e: { cite: string; blob: string; anchorEl: HTMLElement; via: "hover" | "focus" | "click" | "leave" }) {
  if (e.via === "leave") {
    closePeekSoon();
    closeTermSoon();
    return;
  }
  if (peekTimer) clearTimeout(peekTimer);
  const p = fetchPeek(e.cite, e.blob);
  if (!p) return;
  const request = ++peekRequest;
  const claimEl = e.anchorEl.closest(".mc") as HTMLElement | null;
  p.then(
    (data) => {
      if (request !== peekRequest || !e.anchorEl.isConnected) return;
      closePops("peek");
      main?.querySelector("a.mcite.on")?.classList.remove("on");
      e.anchorEl.classList.add("on");
      peek = { data, anchorEl: e.anchorEl, claimEl, pinned: e.via === "click" };
      if (claimEl?.dataset.claim) peeked.add(claimEl.dataset.claim);
      s.layers.open("popover", "peek", () => closePeek());
    },
    () => {},
  );
}

const peekChecks = $derived.by(() => {
  const id = peek?.claimEl?.dataset.claim;
  if (!id || !model) return null;
  for (const p of model.parts) for (const b of p.blocks) for (const c of b.claimViews) if (c.id === id) return c.checks;
  return null;
});
const peekPrecision = $derived.by(() => {
  const id = peek?.claimEl?.dataset.claim;
  if (!id || !model) return "exact" as const;
  for (const p of model.parts) for (const b of p.blocks) for (const c of b.claimViews) if (c.id === id) return c.cites[0]?.precision ?? "exact";
  return "exact" as const;
});

export function pinPeek() {
  if (s.ctx.mode === "code" && s.ctx.pin) {
    if (s.layers.isOpen("ctx-code")) s.layers.close("ctx-code", { restoreFocus: false });
    else onleaveCode();
    return;
  }
  const chip = (peek?.anchorEl ?? (document.activeElement as HTMLElement | null)?.closest?.("a.mcite, a.fcite")) as HTMLElement | null | undefined;
  const cite = chip?.dataset.cite;
  const c = cite ? parseCite(cite) : null;
  if (!c) return;
  const blob = chip?.dataset.blob;
  closePeek();
  s.ctx.set("code", { pin: { path: c.path, start: c.start, end: c.end, ...(blob ? { blob } : {}) } });
  if (route.name === "doc") s.router.replaceUrl({ ...route, ctx: "code", pin: { path: c.path, start: c.start, end: c.end } });
}

export function openEditor() {
  const d = peek?.data;
  const editor = s.prefs.editor;
  const root = s.workspace.status?.info.root;
  if (!d || !root || editor === "none") {
    if (ws) void s.router.go({ name: "wsSettings", ws });
    return;
  }
  location.href = editorUrl(editor, root, d.path, d.start);
}

let term = $state.raw<{ id: string; anchorEl: HTMLElement } | null>(null);
let termHover = false;
const termEntry = $derived.by(() => {
  if (!term || !model) return null;
  for (const p of model.parts) {
    const v = s.doc.section(p.node.id);
    const e = v?.terms?.find((x) => x.id === term?.id);
    if (e) return e;
  }
  return null;
});

let claim = $state.raw<{ block: BlockId; claim: string | null; anchorEl: HTMLElement } | null>(null);
let history = $state.raw<{ block: BlockId; anchorEl: HTMLElement; entries: readonly BlockHistoryEntry[] | null; error: string | null } | null>(null);
let verifying = $state(false);
let opBusy = $state(false);
let translation = $state.raw<{ run: GenRunId; ws: string; lang: DocLang } | null>(null);

async function operation(call: (confirm: boolean) => Promise<BlockOpRes>, name: string): Promise<BlockOpRes | null> {
  const workspace = ws;
  const [{ confirmDocOperation }, { policyAcknowledged }] = await Promise.all([
    import("./operation.ts"),
    import("../map/engine.ts"),
    s.session.loadSettings({ reuse: true }),
    s.session.loadEngines(),
  ]);
  return confirmDocOperation(call, (e) => {
    if (!workspace || ws !== workspace) return false;
    if (!policyAcknowledged(e.engine, s.session.engine(e.engine), s.session.settings?.settings.privacy.dataPolicyAck[e.engine])) {
      if (ws) {
        void s.gen.setEngine(e.engine);
        void s.router.go({ name: "map", ws });
      }
      return false;
    }
    return window.confirm(
      t("reader.op.confirm", { op: name, tokens: e.inTokens + e.outTokens + e.cacheReadTokens + e.cacheWriteTokens, usd: e.apiUsd.toFixed(4), model: e.model }),
    );
  });
}

export async function simplify(block: BlockId) {
  if (!ws || opBusy) return;
  const workspace = ws;
  opBusy = true;
  try {
    const result = await operation(
      (confirm) => s.api.call("POST /ws/:ws/doc/blocks/:block/simplify", { params: { ws: workspace, block }, body: { confirm } }),
      t("reader.act.simplify"),
    );
    if (!result || ws !== workspace) return;
    if (result.proposal) s.doc.upsertProposal(result.proposal);
    await loadExtensions(s);
    s.ui.announce(t("reader.op.proposal"));
  } catch (err) {
    operationError(err);
  } finally {
    opBusy = false;
  }
}

export async function translate(target: { section: SectionId } | { block: BlockId }) {
  if (!ws || opBusy || translation) return;
  const lang = s.prefs.lang;
  const workspace = ws;
  opBusy = true;
  try {
    const result = await operation(
      (confirm) =>
        "section" in target
          ? s.api.call("POST /ws/:ws/doc/sections/:section/translate", { params: { ws: workspace, section: target.section }, body: { lang, confirm } })
          : s.api.call("POST /ws/:ws/doc/blocks/:block/translate", { params: { ws: workspace, block: target.block }, body: { lang, confirm } }),
      t("reader.act.translate"),
    );
    if (!result || ws !== workspace) return;
    if (result.cached) s.doc.setLanguage(lang);
    else if (result.run) {
      translation = { run: result.run, ws: workspace, lang };
      s.ui.announce(t("reader.op.translating"));
    }
  } catch (err) {
    operationError(err);
  } finally {
    opBusy = false;
  }
}

$effect(() => {
  const pending = translation;
  const run = s.gen.run;
  if (!pending || run?.id !== pending.run || (run.state !== "done" && run.state !== "failed")) return;
  untrack(() => {
    if (ws === pending.ws && run.state === "done") s.doc.setLanguage(pending.lang);
    else if (ws === pending.ws) s.ui.announce(t("reader.op.translationFailed"));
    translation = null;
  });
});

function operationError(err: unknown) {
  s.bottom.toast({ id: "doc.op.failed", kind: "error", key: "reader.op.failed", params: { error: errorText(MitoriError.from(err).toData()) } });
}

async function revert(block: BlockId, rev: number) {
  const current = blockViewOf(block);
  if (!ws || !current || verifying || !window.confirm(t("history.revertConfirm", { rev }))) return;
  const workspace = ws;
  verifying = true;
  try {
    const b = await s.api.call("POST /ws/:ws/doc/blocks/:block/revert", { params: { ws: workspace, block }, body: { rev, baseHash: current.hash } });
    if (ws !== workspace) return;
    s.doc.upsertBlock(b);
    closeHistory();
    s.ui.announce(t("history.reverted", { rev }));
  } catch (err) {
    operationError(err);
  } finally {
    verifying = false;
  }
}

export function closeTerm() {
  term = null;
  s.layers.drop("term");
}
function closeTermSoon() {
  setTimeout(() => {
    if (!termHover) closeTerm();
  }, 160);
}
function closeHistory() {
  history = null;
  s.layers.drop("history");
}

/**
 * ONE reader popover at a time (NC-17): opening the peek, a term card, a claim check or the block history closes
 * the others, and each is a layer, so Escape closes whichever is open. The Composer opening closes them all.
 */
export function closePops(keep: "peek" | "term" | "claim" | "history" | null) {
  if (keep !== "peek" && peek) closePeek();
  if (keep !== "term" && term) closeTerm();
  if (keep !== "claim" && claim) {
    claim = null;
    s.layers.drop("claim");
  }
  if (keep !== "history" && history) closeHistory();
}

export function openTerm(e: { term: string; anchorEl: HTMLElement }) {
  closePops("term");
  term = { id: e.term, anchorEl: e.anchorEl };
  s.layers.open("popover", "term", () => (term = null));
}

export function openClaim(e: { block: BlockId; claim: string | null; anchorEl: HTMLElement }) {
  closePops("claim");
  claim = e;
  s.layers.open("popover", "claim", () => (claim = null));
}

/** The block history popover (EX-10): `GET /doc/blocks/:block/history`, newest first. */
export function openHistory(block: BlockId, anchorEl: HTMLElement) {
  if (!ws) return;
  closePops("history");
  history = { block, anchorEl, entries: null, error: null };
  s.layers.open("popover", "history", () => (history = null));
  s.api.call("GET /ws/:ws/doc/blocks/:block/history", { params: { ws, block } }).then(
    (entries) => {
      if (history?.block === block) history = { ...history, entries };
    },
    (err) => {
      if (history?.block === block) history = { ...history, error: errorText(MitoriError.from(err).toData()) };
    },
  );
}

const blockViewOf = (id: BlockId) => model?.parts.flatMap((p) => p.blocks).find((b) => b.id === id) ?? null;

/**
 * The human check of a paragraph (`POST /doc/blocks/:block/verify`): the server marks EVERY claim of the block
 * human-verified (✓✓, kept across regenerations) or takes it back. Optimistic for ✓✓ (rolled back on failure).
 */
async function verifyBlock(block: BlockId, verified: boolean) {
  if (!ws || verifying) return;
  verifying = true;
  const els = verified ? [...(main?.querySelectorAll<HTMLElement>(`.blk[data-b="${CSS.escape(block)}"] .mc[data-claim]`) ?? [])] : [];
  const prev = els.map((el) => el.dataset.verdict);
  for (const el of els) el.dataset.verdict = "human-verified";
  try {
    const v = await s.api.call("POST /ws/:ws/doc/blocks/:block/verify", { params: { ws, block }, body: { verified } });
    s.doc.upsertBlock(v);
    s.ui.announce(t(verified ? "history.announce.verified" : "history.announce.unverified"));
  } catch (err) {
    els.forEach((el, i) => {
      if (prev[i]) el.dataset.verdict = prev[i];
    });
    s.bottom.toast({ id: "verify.failed", kind: "error", key: "toast.verifyFailed", params: { error: errorText(MitoriError.from(err).toData()) } });
  } finally {
    verifying = false;
  }
}

async function verify() {
  const c = claim;
  if (!c) return;
  claim = null;
  s.layers.drop("claim");
  await verifyBlock(c.block, true);
}

/** The peek's ✓✓: the cited claim's paragraph (EX-10 — every claim can be checked, not only the inferred ones). */
const peekBlock = $derived((peek?.anchorEl.closest(".blk") as HTMLElement | null)?.dataset.b as BlockId | undefined);
const peekBlockView = $derived(peekBlock ? blockViewOf(peekBlock) : null);
</script>

{#if peek}
  <CitePeek
    data={peek.data}
    checks={peekChecks}
    precision={peekPrecision}
    anchorEl={peek.anchorEl}
    onpin={pinPeek}
    oneditor={openEditor}
    onenter={() => (peekHover = true)}
    onleave={() => {
      peekHover = false;
      closePeekSoon();
    }}
  >
    {#snippet extra()}
      {#if peekBlockView && peekBlockView.claims.length > 0}
              <PeekVerify
          verified={peekBlockView.lock === "human-verified"}
          n={peekBlockView.claims.length}
          busy={verifying}
          onverify={(next) => peekBlock && void verifyBlock(peekBlock, next)}
        />
      {/if}
    {/snippet}
  </CitePeek>
{/if}
{#if term && termEntry && ws}
  <TermCard
    entry={termEntry}
    anchorEl={term.anchorEl}
    href={HREFS.doc(ws, "s12")}
    onenter={() => (termHover = true)}
    onleave={() => {
      termHover = false;
      closeTermSoon();
    }}
  />
{/if}
{#if history}
  {@const hb = blockViewOf(history.block)}
  <BlockHistory
    entries={history.entries}
    error={history.error}
    anchorEl={history.anchorEl}
    lang={s.prefs.lang}
    verified={hb?.lock === "human-verified"}
    verifiedBy={hb?.verifiedBy ?? null}
    claims={hb?.claims.length ?? 0}
    busy={verifying}
    onverify={(next) => history && void verifyBlock(history.block, next)}
    onrevert={(rev) => history && void revert(history.block, rev)}
    onclose={() => s.layers.close("history")}
  />
{/if}
{#if claim}
  <ClaimPopover
    verdict={(claim.anchorEl.closest(".mc") as HTMLElement | null)?.dataset.verdict ?? "inferred"}
    anchorEl={claim.anchorEl}
    canVerify={level === "expert" || (claim.claim !== null && peeked.has(claim.claim))}
    onverify={verify}
    onask={() => {
      if (claim) oncompose("question", claim.block, claim.claim);
      s.layers.close("claim");
    }}
    onexpert={() => {
      if (claim) oncompose("note", claim.block, claim.claim);
      s.layers.close("claim");
    }}
    onclose={() => s.layers.close("claim")}
  />
{/if}
