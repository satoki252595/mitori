<!--
  S2 設計書 Reader (ux.md §4.3) and S5 (= S2 + context column review). Rail (minimap · reading path · TOC) │ prose
  column (chapter head, BlockHost, pager) │ context column. Keys of the `read` scope live here.
-->
<script lang="ts">
import {
  type BlockHistoryEntry,
  type BlockId,
  type CitePeek as CitePeekData,
  HREFS,
  type LineNo,
  MitoriError,
  type RepoPath,
  type SectionId,
} from "@mitori/core";
import { flushSync, onMount, untrack } from "svelte";
import { copyText } from "../shell/clipboard.ts";
import { loadExtensions, type UiExtension, whenExtensions } from "../shell/ext.ts";
import { welcomeKey } from "../shell/firstrun.ts";
import { hasKey } from "../shell/i18n.ts";
import { ensureNs } from "../shell/i18n-cell.svelte.ts";
import { errorText, t } from "../shell/index.ts";
import { mark } from "../shell/perf.ts";
import Rail from "../shell/Rail.svelte";
import { choosePath, markRead, NEWCOMER_PATH, pathProgress, readMapOf } from "../shell/reading.ts";
import { getItem, STORAGE_KEYS, setItem } from "../shell/storage.ts";
import { currentLayout, setReaderLevel, useStores } from "../stores/app.svelte.ts";
import BlockHost from "./BlockHost.svelte";
import ContextColumn from "./ContextColumn.svelte";
import { editorUrl, factPeek, parseCite } from "./code.ts";
import { applyLevel } from "./decorate.ts";
import { paintFind } from "./find.ts";
import Gutter from "./Gutter.svelte";
import { blockVisibleImpl, permalinkTextImpl, stepLevel } from "./levels.ts";
import Minimap from "./Minimap.svelte";
import { readingMinutes, subtreeStats } from "./outline.ts";
import { buildPage, genNoteOf, type PagePart, sectionsToFetch, stepBlock } from "./page.ts";
import { reviewAnchor } from "./review-anchor.ts";
import { type Anchor, captureAnchor, restoreAnchor } from "./scroll-anchor.ts";
import Welcome from "./Welcome.svelte";

const s = useStores();
// peek / term card / claim popover: a lazy chunk, fetched when idle after the first section paint (or on demand)
let pop = $state.raw<typeof import("./pop.ts") | null>(null);
let popLoading: Promise<unknown> | null = null;
function loadPop(): void {
  popLoading ??= import("./pop.ts").then((m) => (pop = m));
}
const route = $derived(s.router.route);
const ws = $derived("ws" in route ? route.ws : null);
const ix = $derived(s.doc.index);
const level = $derived(s.doc.level);
const layout = $derived(currentLayout(s));
let ext = $state.raw<UiExtension | null>(null);
let host: BlockHost | undefined = $state();
let main: HTMLElement | undefined = $state();
let focused = $state<BlockId | null>(null);
let forced = $state.raw<ReadonlySet<BlockId>>(new Set());
let loadError = $state<string | null>(null);
let reviewSection = $state<SectionId | null>(null);
/** EX-09: the block the reviewed job is anchored on (or its first doc proposal's): the left body opens THERE. */
let reviewBlock = $state<BlockId | null>(null);

// ---------------------------------------------------------------- which page
const section = $derived<SectionId | null>(route.name === "doc" ? route.section : route.name === "review" ? (reviewSection ?? null) : null);
const page = $derived(section && ix ? (ix.pageOf.get(section) ?? section) : null);
const model = $derived(page && ix ? buildPage(ix, page, (id) => s.doc.section(id)) : null);
const loaded = $derived(!!model && model.parts.length > 0 && model.parts.every((p) => p.loaded));

$effect(() => {
  if (route.name === "review" && ws) {
    const job = route.job;
    untrack(() => {
      s.ctx.set("review", { job });
      void s.review.jobDetail(job).then(
        (d) => {
          const block = reviewAnchor(d, (id) => s.review.threads.get(id));
          reviewBlock = block;
          reviewSection = (block && s.doc.index?.blockSection.get(block)) || "s0";
        },
        () => {
          reviewBlock = null;
          reviewSection = "s0";
        },
      );
    });
  } else if (route.name === "doc") {
    const r = route;
    untrack(() => {
      if (r.ctx === "code") {
        // the URL carries path:a-b only: the pin set from a chip keeps its cited blob (EX-08)
        const cur = s.ctx.pin;
        const same = !!cur && !!r.pin && cur.path === r.pin.path && cur.start === r.pin.start && cur.end === r.pin.end;
        s.ctx.set("code", r.pin ? { pin: same && cur ? cur : r.pin } : {});
      } else if (r.ctx === "review") s.ctx.set("review");
      else s.ctx.defaultFor(s.doc.level);
    });
  }
});

// load the page (+ same-file children the page view did not include)
$effect(() => {
  const pg = page;
  const index = ix;
  const anchor = route.name === "doc" ? route.block : (reviewBlock ?? undefined);
  if (!pg || !index) return;
  untrack(() => {
    s.doc.page = pg;
    loadError = null;
    s.doc
      .load(pg, { anchor })
      .then(() => Promise.all(sectionsToFetch(index, pg, (id) => s.doc.section(id)).map((id) => s.doc.load(id, { anchor }))))
      .catch((err) => (loadError = errorText(MitoriError.from(err).toData())));
  });
});

// first paint after a navigation: mark, focus, scroll (hash / sub-section / restored), announce. Keyed by the
// router's navigation counter, so j / k (which only replace the URL's block hash) never re-run it.
let paintedFor: string | null = null;
$effect(() => {
  if (!loaded || !model) return;
  const key = `${model.page}|${s.router.nav}`;
  if (paintedFor === key) return;
  paintedFor = key;
  untrack(() => {
    const r = route;
    requestAnimationFrame(() => {
      mark("mitori:section:rendered", { id: model.page });
      s.router.painted();
      if (!pop) (globalThis.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(() => loadPop());
    });
    const restored = s.router.restored;
    if (restored) {
      window.scrollTo(0, restored.scrollY);
      if (restored.focusBlock) focusBlock(restored.focusBlock as BlockId, false);
    } else if (r.name === "doc" && r.block) {
      focusBlock(r.block, true);
      // a ⌘K full-text jump marks the words it matched (NC-09)
      const f = s.ui.find;
      if (f && f.block === r.block) {
        s.ui.find = null;
        const el = main?.querySelector(`.blk[data-b="${CSS.escape(r.block)}"]`);
        if (el) {
          el.scrollIntoView({ block: "center" });
          paintFind(el, f.words);
        }
      }
    } else if (r.name === "doc" && r.section !== model.page) {
      document.querySelector(`[data-sec="${CSS.escape(r.section)}"]`)?.scrollIntoView({ block: "start" });
    } else if (r.name === "review" && reviewBlock) {
      // EX-09: the anchored block (and its proposal right after it) in the middle of the left column, marked; the
      // keyboard stays with the Review panel
      const b = reviewBlock;
      host?.ensureMounted(b);
      focused = b;
      flushSync();
      main?.querySelector(`.blk[data-b="${CSS.escape(b)}"]`)?.scrollIntoView({ block: "center" });
    } else window.scrollTo(0, 0);
    // the page heading gets focus (§2.3-5) unless the link targeted a block, which then keeps it
    if (s.router.focusMain && !restored && !(r.name === "doc" && r.block) && r.name !== "review")
      (main?.querySelector("h1") as HTMLElement | null)?.focus({ preventScroll: true });
    const n = ix?.nodes.get(model.page);
    if (n) s.ui.announce(t("reader.announce.page", { num: ix?.numbers.get(model.page) ?? "", title: n.title }));
  });
});

// ---------------------------------------------------------------- level switch: keep the first visible block in place (AC-J20)
$effect(() => {
  const l = level;
  if (main) untrack(() => applyLevel(main as HTMLElement, l));
});

// SSE block mutations and level switches keep the reading position (ux.md §4.3.9-5, AC-J20)
onMount(() => {
  s.doc.mutate = (apply) => {
    const a = main ? captureAnchor(main) : null;
    flushSync(apply);
    if (main) restoreAnchor(main, a, model?.order);
  };
  s.doc.levelTransition = () => {
    const a: Anchor | null = main ? captureAnchor(main) : null;
    return () => {
      if (!main) return;
      applyLevel(main, s.doc.level);
      restoreAnchor(main, a, model?.order);
    };
  };
  // the margin cards show once the shell has loaded the loop UI (after the first paint, F5)
  void whenExtensions().then((e) => (ext = e));
  s.router.focusedBlock = () => (focused && main?.querySelector(`.blk[data-b="${CSS.escape(focused)}"]`) ? focused : null);
  // NC-17: no reader popover stays over a Composer (selection toolbar, gutter, ⌘K 「AI に聞く」)
  const onComposer = () => closePops(null);
  // ⌘K 「この段落の履歴」 (the focused block)
  const onHistory = () => {
    const b = focused;
    const el = b ? main?.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(b)}"]`) : null;
    if (b && el) openHistory(b, el);
  };
  window.addEventListener("mitori:composer:open", onComposer);
  window.addEventListener("mitori:block-history", onHistory);
  return () => {
    window.removeEventListener("mitori:composer:open", onComposer);
    window.removeEventListener("mitori:block-history", onHistory);
    s.doc.mutate = (apply) => apply();
    s.doc.levelTransition = null;
    s.router.focusedBlock = null;
  };
});

// ---------------------------------------------------------------- j / k / chapter / level / cites / permalink
function isVisible(id: BlockId): boolean {
  if (forced.has(id)) return true;
  const b = model?.parts.flatMap((p) => p.blocks).find((x) => x.id === id);
  return !!b && blockVisibleImpl(b, level) !== "hidden";
}

function focusBlock(id: BlockId, scroll: boolean) {
  host?.ensureMounted(id);
  focused = id;
  flushSync();
  const el = main?.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(id)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (scroll) el.scrollIntoView({ block: "nearest" });
  if (route.name === "doc") s.router.replaceUrl({ ...route, block: id });
}

onMount(() => {
  const k = s.keys;
  const offs = [
    k.on("read.next", () => {
      const id = model && stepBlock(model.order, focused, 1, isVisible);
      if (id) focusBlock(id, true);
    }),
    k.on("read.prev", () => {
      const id = model && stepBlock(model.order, focused, -1, isVisible);
      if (id) focusBlock(id, true);
    }),
    k.on("read.chapter", (e) => {
      const n = Number(/^Digit(\d)$|^Numpad(\d)$/.exec(e.code)?.slice(1).find(Boolean) ?? e.key);
      const target = ix?.pages.filter((p) => !p.includes("/"))[n - 1];
      if (target && ws) void s.router.go({ name: "doc", ws, section: target });
    }),
    k.on("level.down", () => setLevel(stepLevel(s.doc.level, -1))),
    k.on("level.up", () => setLevel(stepLevel(s.doc.level, 1))),
    k.on("level.reset", () => setLevel("standard")),
    k.on("cites.toggleAll", () => (s.ui.showCites = !s.ui.showCites)),
    k.on("copy.permalink", () => void permalink()),
    k.on("peek.pin", () => pinPeek()),
    k.on("peek.openEditor", () => openEditor()),
    k.on("read.claimNext", () => claimCursor(1)),
    k.on("read.claimPrev", () => claimCursor(-1)),
    k.on("act.comment", () => compose("note")),
    k.on("act.explain", () => compose("question")),
    k.on("act.fix", () => compose("change")),
    k.on("review.open", () => {
      const job = s.review.oldestReady();
      if (job && ws) void s.router.go({ name: "review", ws, job });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
});

function setLevel(l: typeof level) {
  setReaderLevel(s, l);
  s.ui.announce(t("reader.announce.level", { level: t(`level.${l}`) }));
}

async function permalink() {
  if (!model || !ix || !ws) return;
  const block = focused;
  const sec = block ? (ix.blockSection.get(block) ?? model.page) : model.page;
  const node = ix.nodes.get(sec);
  const el = block ? main?.querySelector(`.blk[data-b="${CSS.escape(block)}"] a.mcite .cs`) : null;
  const info = s.workspace.status?.info;
  const b = block ? model.parts.flatMap((p) => p.blocks).find((x) => x.id === block) : null;
  const remote = info?.remote?.provider === "github" && info.docCommitted && s.workspace.status?.snapshot?.commit;
  const url =
    remote && info?.remote && b
      ? `${info.remote.url}/blob/${s.workspace.status?.snapshot?.commit}/${info.docDir}/${b.file}#L${b.mdLine}`
      : `mitori open ${info?.docId ?? ws}${block ? `#${block}` : ""}`;
  const title = `${ix.numbers.get(sec) ?? ""} ${node?.title ?? ""}`.trim();
  await copyText(permalinkTextImpl({ section: sec, title, ...(el?.textContent ? { cite: el.textContent } : {}), url }), s, "copy.permalink");
}

// claim cursor (Alt+J / Alt+K): CSS Custom Highlight over `.mc[data-claim]`, no DOM split (UXP-17)
let claimIdx = -1;
function claimCursor(dir: 1 | -1) {
  const claims = [...(main?.querySelectorAll<HTMLElement>(".blk .mc[data-claim]") ?? [])].filter((c) => c.getClientRects().length > 0);
  if (!claims.length) return;
  claimIdx = Math.max(0, Math.min(claims.length - 1, claimIdx + dir));
  const c = claims[claimIdx] as HTMLElement;
  const range = document.createRange();
  range.selectNodeContents(c);
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  if (H && reg) reg.set("mitori-claim", new H(range));
  const blk = c.closest(".blk") as HTMLElement | null;
  if (blk?.dataset.b) focused = blk.dataset.b as BlockId;
  c.scrollIntoView({ block: "nearest" });
}

// Composer hand-off (WP-10b listens): anchor = focused block / claim cursor / selection
function compose(intent: "note" | "question" | "change", block: BlockId | null = focused, claim: string | null = null) {
  if (!block) {
    // one hint per session, shared with the keyboard path (Shell `unmet`, UXP-35)
    if (!getItem("session", STORAGE_KEYS.hint("noTarget"))) {
      setItem("session", STORAGE_KEYS.hint("noTarget"), "1");
      s.bottom.toast({ id: "hint.noTarget", kind: "info", key: "hint.noTarget" });
    }
    return;
  }
  closePops(null);
  const detail = { block, claim, intent };
  if (ext) {
    window.dispatchEvent(new CustomEvent("mitori:compose", { detail }));
    return;
  }
  // the loop UI is still on its way (F5): ask for it now and hand over once it listens
  void loadExtensions(s).then(
    (e) => {
      ext = e;
      if (e.margin) window.dispatchEvent(new CustomEvent("mitori:compose", { detail }));
      else s.bottom.toast({ id: "hint.loopPending", kind: "info", key: "hint.loopPending" });
    },
    () => s.bottom.toast({ id: "hint.loopPending", kind: "info", key: "hint.loopPending" }),
  );
}

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
function closePeek() {
  peek = null;
  s.layers.drop("peek");
  main?.querySelector("a.mcite.on")?.classList.remove("on");
}

function onCite(e: { cite: string; blob: string; anchorEl: HTMLElement; via: "hover" | "focus" | "click" | "leave" }) {
  if (e.via === "leave") {
    closePeekSoon();
    closeTermSoon();
    return;
  }
  loadPop();
  if (peekTimer) clearTimeout(peekTimer);
  const p = fetchPeek(e.cite, e.blob);
  if (!p) return;
  const claimEl = e.anchorEl.closest(".mc") as HTMLElement | null;
  p.then(
    (data) => {
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

/** `o` again / Escape in code mode: back to the previous mode, and the permalink no longer carries ctx / pin. */
function leaveCode() {
  s.ctx.back();
  if (route.name === "doc" && (route.ctx || route.pin)) {
    const { ctx: _ctx, pin: _pin, ...rest } = route;
    s.router.replaceUrl(rest);
  }
}

$effect(() => {
  const back = s.ctx.canGoBack;
  untrack(() => {
    if (back) {
      if (!s.layers.isOpen("ctx-code")) s.layers.open("ctxMode", "ctx-code", leaveCode);
    } else s.layers.drop("ctx-code");
  });
});

function pinPeek() {
  if (s.ctx.mode === "code" && s.ctx.pin) {
    if (s.layers.isOpen("ctx-code")) s.layers.close("ctx-code", { restoreFocus: false });
    else leaveCode();
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

function openEditor() {
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

function closeTerm() {
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
function closePops(keep: "peek" | "term" | "claim" | "history" | null) {
  if (keep !== "peek" && peek) closePeek();
  if (keep !== "term" && term) closeTerm();
  if (keep !== "claim" && claim) {
    claim = null;
    s.layers.drop("claim");
  }
  if (keep !== "history" && history) closeHistory();
}

function openTerm(e: { term: string; anchorEl: HTMLElement }) {
  loadPop();
  closePops("term");
  term = { id: e.term, anchorEl: e.anchorEl };
  s.layers.open("popover", "term", () => (term = null));
}

function openClaim(e: { block: BlockId; claim: string | null; anchorEl: HTMLElement }) {
  closePops("claim");
  claim = e;
  s.layers.open("popover", "claim", () => (claim = null));
}

/** The block history popover (EX-10): `GET /doc/blocks/:block/history`, newest first. */
function openHistory(block: BlockId, anchorEl: HTMLElement) {
  if (!ws) return;
  loadPop();
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

// ---------------------------------------------------------------- shared gutter
let gutter = $state<{ block: BlockId | null; top: number; left: number }>({ block: null, top: 0, left: 0 });
let gutterHover = false;
let gutterTimer: ReturnType<typeof setTimeout> | null = null;
let docCol: HTMLElement | undefined = $state();
function placeGutter(b: BlockId, el: HTMLElement) {
  if (!docCol) return;
  const r = el.getBoundingClientRect();
  const c = docCol.getBoundingClientRect();
  // left gutter column; the ✓ pseudo-element keeps the top 28 px
  gutter = { block: b, top: r.top - c.top + 28, left: r.left - c.left - 34 };
}
function onHoverBlock(b: BlockId | null, el: HTMLElement | null) {
  if (gutterTimer) clearTimeout(gutterTimer);
  if (b && el) return placeGutter(b, el);
  gutterTimer = setTimeout(() => {
    if (!gutterHover && !focused) gutter = { ...gutter, block: null };
  }, 160);
}
$effect(() => {
  const f = focused;
  if (!f || !docCol) return;
  const el = docCol.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(f)}"]`);
  if (el) placeGutter(f, el);
});

// ---------------------------------------------------------------- scrollspy (code mode follows the first visible block's main cite)
let spy = $state.raw<{ path: RepoPath; start: LineNo; end: LineNo; blob?: string } | null>(null);
$effect(() => {
  if (s.ctx.mode !== "code" || s.ctx.pin || !main || !loaded) return;
  let settle: ReturnType<typeof setTimeout> | null = null;
  const io = new IntersectionObserver(
    (entries) => {
      const first = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const chip = first?.target.querySelector<HTMLElement>("a.mcite");
      const cite = chip?.dataset.cite;
      if (!cite) return;
      const blob = chip?.dataset.blob;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        const c = parseCite(cite);
        spy = c ? { ...c, ...(blob ? { blob } : {}) } : null;
      }, 100);
    },
    { rootMargin: "-18% 0px -62% 0px" },
  );
  for (const el of main.querySelectorAll(".blk")) io.observe(el);
  return () => io.disconnect();
});

// a running / paused generation: its stage names (the streaming tail) are in the gen strings (i18n-ns.ts `gen`)
$effect(() => {
  const st = s.gen.run?.state;
  if (st === "running" || st === "paused") untrack(() => void ensureNs("gen"));
});

// ---------------------------------------------------------------- reading-path progress (a section's END marker passes the bottom 20 %)
function onRead(sec: SectionId) {
  // a section read counts for every course that stops there (NC-15)
  if (ws && markRead(ws, sec, new Date().toISOString())) s.ui.readTick++;
}

// tail of the running generation (`◐ 生成中 · modules · internal/session`, §4.3.9-6)
const streamTail = $derived.by(() => {
  const running = s.gen.tasks.filter((x) => x.state === "running");
  const last = running[running.length - 1];
  return last ? (hasKey(`gen.stage.${last.stage}`) ? `${t(`gen.stage.${last.stage}`)} · ${last.target.id}` : last.target.id) : null;
});

// ---------------------------------------------------------------- placeholders: first click estimates, second runs
async function onPlaceholder(sec: SectionId) {
  if (s.gen.sectionEstimates.has(sec)) {
    if (await s.gen.runSection(sec))
      s.bottom.toast({ id: "gen.prioritized", kind: "info", key: "toast.gen.prioritized", params: { id: ix?.numbers.get(sec) ?? sec } });
  } else {
    const e = await s.gen.estimateSection(sec);
    if (e)
      s.bottom.toast({
        id: "gen.sectionEstimate",
        kind: "info",
        key: "toast.gen.sectionEstimate",
        params: { k: Math.round((e.inTokens + e.outTokens + e.cacheReadTokens) / 100) / 10 },
      });
  }
}

const next = $derived.by(() => {
  if (!ix || !model) return null;
  const pages = ix.pages;
  const i = pages.indexOf(model.page);
  return i >= 0 ? (pages[i + 1] ?? null) : null;
});
const uiLang = $derived(s.prefs.lang);
const docLang = $derived(s.doc.lang);
const notGenerated = $derived(!s.doc.outline?.manifest.generatedAt);
const reviewPanel = $derived(ext?.reviewPanel ?? null);

// ---------------------------------------------------------------- 「この節について」 (empty margin): stats + cited files
let citedFiles = $state.raw<{ path: RepoPath; n: number; start: LineNo; end: LineNo }[]>([]);
$effect(() => {
  if (!loaded || !main || !model) return;
  void model.page;
  const root = main;
  // after the blocks (and their decoration) are in the DOM
  const raf = requestAnimationFrame(() => {
    const by = new Map<string, { path: RepoPath; n: number; start: LineNo; end: LineNo }>();
    for (const a of root.querySelectorAll<HTMLElement>("a.mcite[data-cite], a.fcite[data-cite]")) {
      const c = parseCite(a.dataset.cite ?? "");
      if (!c) continue;
      const cur = by.get(c.path);
      if (cur) cur.n++;
      else by.set(c.path, { path: c.path, n: 1, start: c.start, end: c.end });
    }
    citedFiles = [...by.values()].sort((a, b) => b.n - a.n || (a.path < b.path ? -1 : 1));
  });
  return () => cancelAnimationFrame(raf);
});
const about = $derived.by(() => {
  if (!model || !ix) return null;
  const st = subtreeStats(ix, model.page);
  const blocks = model.parts.reduce((n, p) => n + p.blocks.length, 0);
  return {
    minutes: readingMinutes(model.parts[0]?.node.readingSec ?? 0),
    blocks,
    verified: st.verified,
    inferred: st.inferred,
    stale: st.stale,
    staticOnly: model.parts.every((p) => p.node.state === "static_only"),
    files: citedFiles,
  };
});
const marginView = $derived(ext?.margin ?? null);

// ---------------------------------------------------------------- NC-14 the doc is in another language than the UI
/**
 * The translation entry point that works today: the AI explains the section in the UI's language (an Explain draft on
 * the section's first paragraph, the question typed in, nothing sent until the user presses send). The section /
 * block translate routes are not wired on the daemon (501), so no 「訳を表示」 promises what cannot run.
 */
function askInUiLang(p: PagePart) {
  const b = p.blocks.find((x) => x.kind !== "heading" && x.status !== "placeholder");
  if (!b) return;
  host?.ensureMounted(b.id);
  focused = b.id;
  void loadExtensions(s).then(() =>
    window.dispatchEvent(new CustomEvent("mitori:compose", { detail: { block: b.id, claim: null, intent: "question", body: t("reader.translateAskBody") } })),
  );
}

// ---------------------------------------------------------------- §0 welcome: the 5-minute course (NC-08 / NC-13)
let welcomeClosed = $state(false);
const welcome = $derived.by(() => {
  void s.ui.readTick;
  const w = ws;
  const o = s.doc.outline;
  if (!w || !o?.manifest.generatedAt || welcomeClosed || getItem("local", welcomeKey(w))) return null;
  const five = o.readingPaths.find((p) => p.id === NEWCOMER_PATH);
  if (!five || five.steps.length === 0) return null;
  const prog = pathProgress(five, readMapOf(w, five.id), (id) => ix?.nodes.get(id)?.readingSec ?? 0);
  return prog.done ? null : { path: five, prog };
});
function closeWelcome() {
  if (ws) setItem("local", welcomeKey(ws), new Date().toISOString().slice(0, 10));
  welcomeClosed = true;
}
function startCourse() {
  const w = welcome;
  if (!ws || !w) return;
  choosePath(ws, w.path.id);
  s.ui.readTick++;
  const next = w.prog.next ?? w.path.steps[0]?.section;
  if (next && next !== model?.page) void s.router.go({ name: "doc", ws, section: next });
  else main?.querySelector<HTMLElement>(".sec-body .blk")?.focus();
}
</script>

{#snippet head(p: PagePart)}
  {@const st = ix ? subtreeStats(ix, p.node.id) : null}
  {#if p.top}
    <header class="sec-head" data-chrome>
      <!-- UI ≠ doc language: the note shares the § row (fixed height) so switching the UI language moves nothing -->
      <p class="sec-num">
        &sect;{p.num}{#if uiLang !== docLang}<span class="lang-note">{t("reader.translateBand")}</span
          ><button type="button" class="lang-ask" onclick={() => askInUiLang(p)}>{t("reader.translateAsk")}</button>{/if}
      </p>
      <h1 tabindex="-1" data-user-content>{p.node.title}</h1>
      <p class="sec-meta">
        <span>{t("reader.meta.minutes", { n: readingMinutes(p.node.readingSec) })}</span>
        {#if st && st.verified > 0}<span class="sep" aria-hidden="true">&middot;</span><span>{t("reader.meta.verified", { n: st.verified })}</span>{/if}
        {#if st && st.inferred > 0}<span class="sep" aria-hidden="true">&middot;</span><span class="guess">{t("reader.meta.inferred", { n: st.inferred })}</span>{/if}
        {#if st && st.stale > 0}<span class="sep" aria-hidden="true">&middot;</span><span class="stale">{t("reader.meta.stale", { n: st.stale })}</span>{/if}
        {#if p.node.state === "static_only"}<span class="sep" aria-hidden="true">&middot;</span><span class="static-tag">{t("reader.meta.static")}</span>{/if}
        {#if s.workspace.head7}<span class="sep" aria-hidden="true">&middot;</span><span class="mono">{s.workspace.head7}</span>{/if}
        {#if s.doc.outline?.manifest.models[0]}<span class="sep" aria-hidden="true">&middot;</span><span class="mono">{s.doc.outline.manifest.models[0]}</span>{/if}
      </p>
    </header>
    {#if p.node.id === "s0" && welcome && ws}
      <Welcome
        {ws}
        path={welcome.path}
        prog={welcome.prog}
        {level}
        numbers={(id) => ix?.numbers.get(id) ?? ""}
        titles={(id) => ix?.nodes.get(id)?.title ?? ""}
        onstart={startCourse}
        onlevel={(l) => setLevel(l)}
        onclose={closeWelcome}
      />
    {/if}
    {@const note = genNoteOf(s.gen.run, p.node, !notGenerated)}
    {#if note === "paused" || note === "pausedBudget"}
      <!-- EX-11: a run paused (budget / the 5h window) says so and resumes here; a written page never claims to be ungenerated -->
      <p class="gen-note" data-chrome>
        <span>{t(note === "pausedBudget" ? "reader.genPausedBudget" : "reader.genPaused")}</span>
        <button type="button" class="btn btn-sec btn-s" onclick={() => void s.gen.control("resume")}>{t("reader.genResume")}</button>
      </p>
    {:else if note === "notGenerated"}
      <p class="gen-note" data-chrome>
        <span>{t("reader.notGenerated")}</span>
        {#if ws}<a class="btn btn-sec btn-s" href={HREFS.map(ws)}>{t("reader.seeEstimate")}</a>{/if}
      </p>
    {/if}
  {:else}
    <h2 class="sub" id={`sec-${p.node.id}`}><span class="hn">{p.num}</span><span data-user-content>{p.node.title}</span></h2>
  {/if}
{/snippet}

<div class="body reader-body" style:grid-template-columns="{layout.rail}px minmax(0,1fr) {layout.ctxPlacement === 'column' ? layout.ctx : 0}px">
  <Rail mode={layout.railMode}>
    {#snippet top()}
      <!-- not gated on the outline: its box is there from the first paint (the outline arriving moves nothing) -->
      {#if !s.map.fallback}<Minimap page={model?.page ?? null} />{/if}
    {/snippet}
  </Rail>

  <main id="main" class="doc" tabindex="-1" bind:this={main} lang={docLang}>
    <div class="doc-col" bind:this={docCol}>
      {#if loadError}
        <div class="err-card" role="alert" data-chrome>
          <h2>{t("reader.loadError")}</h2>
          <p>{loadError}</p>
          <button type="button" class="btn btn-sec btn-s" onclick={() => page && s.doc.load(page).catch(() => {})}>{t("app.retry")}</button>
        </div>
      {:else if model && loaded}
        <Gutter
          block={gutter.block}
          top={gutter.top}
          left={gutter.left}
          onaction={(a, el) => {
            if (a === "history") {
              if (gutter.block && el) openHistory(gutter.block, el);
              return;
            }
            compose(a === "comment" ? "note" : a === "explain" ? "question" : "change", gutter.block);
          }}
          onenter={() => (gutterHover = true)}
          onleave={() => (gutterHover = false)}
        />
        <BlockHost
          bind:this={host}
          page={model}
          {level}
          streaming={s.doc.streaming}
          {focused}
          {forced}
          {head}
          oncite={onCite}
          onterm={(e) => (e ? openTerm(e) : closeTerm())}
          onclaim={openClaim}
          onhoverblock={onHoverBlock}
          onplaceholder={onPlaceholder}
          onmore={(ids) => (forced = new Set([...forced, ...ids]))}
          generating={s.gen.run?.state === "running" || s.gen.run?.state === "paused"}
          docLang={s.doc.lang}
          tail={streamTail}
          mutate={(apply) => s.doc.mutate(apply)}
          codeHref={(p, a, b) => (ws ? HREFS.code(ws, p as RepoPath, a as LineNo, b as LineNo) : null)}
          onread={onRead}
        />
        {#if next && ws}
          <nav class="pager" aria-label={t("reader.pager")} data-chrome>
            <a href={HREFS.doc(ws, next)} onpointerenter={() => s.doc.prefetch(next)}>
              <span class="k">{t("reader.next")}</span>
              <span class="t">&sect;{ix?.numbers.get(next)} <span data-user-content>{ix?.nodes.get(next)?.title}</span></span>
            </a>
          </nav>
        {/if}
      {:else}
        <div class="prose skel-page" aria-busy="true">
          <div class="skel" style="width: 3em; height: 15px; margin-bottom: 8px"></div>
          <div class="skel" style="width: 12em; height: 40px; margin-bottom: 14px"></div>
          <div class="skel" style="width: 22em; height: 14px; margin-bottom: 40px"></div>
          {#each Array(6) as _, i (i)}<div class="skel" style="height: 88px; margin-bottom: 14px"></div>{/each}
        </div>
      {/if}
    </div>
  </main>

  <ContextColumn
    placement={layout.ctxPlacement}
    width={layout.ctx}
    page={model?.page ?? "s0"}
    {spy}
    about={about}
    margin={marginView}
    review={reviewPanel}
    onwidth={(px) => {
      s.ctx.codeWidth = Math.max(420, Math.min(900, Math.round(px)));
      s.prefs.setCodeWidth(s.ctx.codeWidth);
    }}
  />
</div>

{#if peek && pop}
  {@const CitePeek = pop.CitePeek}
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
      {#if pop && peekBlockView && peekBlockView.claims.length > 0}
        {@const PeekVerify = pop.PeekVerify}
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
{#if term && termEntry && ws && pop}
  {@const TermCard = pop.TermCard}
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
{#if history && pop}
  {@const BlockHistory = pop.BlockHistory}
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
    onclose={() => s.layers.close("history")}
  />
{/if}
{#if claim && pop}
  {@const ClaimPopover = pop.ClaimPopover}
  <ClaimPopover
    verdict={(claim.anchorEl.closest(".mc") as HTMLElement | null)?.dataset.verdict ?? "inferred"}
    anchorEl={claim.anchorEl}
    canVerify={level === "expert" || (claim.claim !== null && peeked.has(claim.claim))}
    onverify={verify}
    onask={() => {
      if (claim) compose("question", claim.block, claim.claim);
      s.layers.close("claim");
    }}
    onexpert={() => {
      if (claim) compose("note", claim.block, claim.claim);
      s.layers.close("claim");
    }}
    onclose={() => s.layers.close("claim")}
  />
{/if}

<style>
  .reader-body {
    align-items: start;
  }
  .doc-col {
    position: relative;
  }
  .skel-page .skel {
    display: block;
  }
</style>
