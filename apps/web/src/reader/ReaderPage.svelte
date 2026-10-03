<!--
  S2 設計書 Reader (ux.md §4.3) and S5 (= S2 + context column review). Rail (minimap · reading path · TOC) │ prose
  column (chapter head, BlockHost, pager) │ context column. Keys of the `read` scope live here.
-->
<script lang="ts">
import { type BlockId, type CitePeek as CitePeekData, HREFS, type LineNo, MitoriError, type RepoPath, type SectionId } from "@mitori/core";
import { flushSync, onMount, untrack } from "svelte";
import { copyText } from "../shell/clipboard.ts";
import { loadExtensions, type UiExtension } from "../shell/ext.ts";
import { errorText, t } from "../shell/index.ts";
import { mark } from "../shell/perf.ts";
import Rail from "../shell/Rail.svelte";
import { DEFAULT_PATH, selectedPath } from "../shell/reading.ts";
import { getItem, getJson, STORAGE_KEYS, setItem, setJson } from "../shell/storage.ts";
import { currentLayout, setReaderLevel, useStores } from "../stores/app.svelte.ts";
import BlockHost from "./BlockHost.svelte";
import CitePeek from "./CitePeek.svelte";
import ClaimPopover from "./ClaimPopover.svelte";
import ContextColumn from "./ContextColumn.svelte";
import { editorUrl, parseCite } from "./code.ts";
import { applyLevel } from "./decorate.ts";
import Gutter from "./Gutter.svelte";
import { blockVisibleImpl, permalinkTextImpl, stepLevel } from "./levels.ts";
import Minimap from "./Minimap.svelte";
import { readingMinutes, subtreeStats } from "./outline.ts";
import { buildPage, type PagePart, sectionsToFetch, stepBlock } from "./page.ts";
import { type Anchor, captureAnchor, restoreAnchor } from "./scroll-anchor.ts";
import TermCard from "./TermCard.svelte";

const s = useStores();
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
          const th = d.threads.map((id) => s.review.threads.get(id)).find((x) => x?.anchor.doc);
          const block = th?.anchor.doc?.block;
          reviewSection = (block && s.doc.index?.blockSection.get(block)) || "s0";
        },
        () => (reviewSection = "s0"),
      );
    });
  } else if (route.name === "doc") {
    const r = route;
    untrack(() => {
      if (r.ctx === "code") s.ctx.set("code", r.pin ? { pin: r.pin } : {});
      else if (r.ctx === "review") s.ctx.set("review");
      else s.ctx.defaultFor(s.doc.level);
    });
  }
});

// load the page (+ same-file children the page view did not include)
$effect(() => {
  const pg = page;
  const index = ix;
  if (!pg || !index) return;
  untrack(() => {
    s.doc.page = pg;
    loadError = null;
    s.doc
      .load(pg)
      .then(() => Promise.all(sectionsToFetch(index, pg, (id) => s.doc.section(id)).map((id) => s.doc.load(id))))
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
    });
    const restored = s.router.restored;
    if (restored) {
      window.scrollTo(0, restored.scrollY);
      if (restored.focusBlock) focusBlock(restored.focusBlock as BlockId, false);
    } else if (r.name === "doc" && r.block) {
      focusBlock(r.block, true);
    } else if (r.name === "doc" && r.section !== model.page) {
      document.querySelector(`[data-sec="${CSS.escape(r.section)}"]`)?.scrollIntoView({ block: "start" });
    } else window.scrollTo(0, 0);
    // the page heading gets focus (§2.3-5) unless the link targeted a block, which then keeps it
    if (s.router.focusMain && !restored && !(r.name === "doc" && r.block)) (main?.querySelector("h1") as HTMLElement | null)?.focus({ preventScroll: true });
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
  void loadExtensions(s).then((e) => (ext = e));
  return () => {
    s.doc.mutate = (apply) => apply();
    s.doc.levelTransition = null;
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
  window.dispatchEvent(new CustomEvent("mitori:compose", { detail: { block, claim, intent } }));
  if (!ext?.margin) s.bottom.toast({ id: "hint.loopPending", kind: "info", key: "hint.loopPending" });
}

// ---------------------------------------------------------------- cite peek / term card / claim popover
let peek = $state.raw<{ data: CitePeekData; anchorEl: HTMLElement; claimEl: HTMLElement | null; pinned: boolean } | null>(null);
let peekHover = false;
let peekTimer: ReturnType<typeof setTimeout> | null = null;
const peekCache = new Map<string, Promise<CitePeekData>>();
const peeked = new Set<string>();

function fetchPeek(cite: string, blob: string): Promise<CitePeekData> | null {
  const c = parseCite(cite);
  if (!c || !ws) return null;
  const key = `${cite}@${blob}`;
  let p = peekCache.get(key);
  if (!p) {
    p = s.api.call("GET /ws/:ws/cite", { params: { ws }, query: { path: c.path, start: c.start, end: c.end, blob, ctx: 3 } });
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
  if (e.via === "leave") return closePeekSoon();
  if (peekTimer) clearTimeout(peekTimer);
  const p = fetchPeek(e.cite, e.blob);
  if (!p) return;
  const claimEl = e.anchorEl.closest(".mc") as HTMLElement | null;
  p.then(
    (data) => {
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
  const cite = peek?.anchorEl.dataset.cite ?? (document.activeElement as HTMLElement | null)?.closest?.("a.mcite")?.getAttribute("data-cite");
  const c = cite ? parseCite(cite) : null;
  if (!c) return;
  closePeek();
  s.ctx.set("code", { pin: { path: c.path, start: c.start, end: c.end } });
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
async function verify() {
  const c = claim;
  if (!c || !ws) return;
  const el = c.claim ? main?.querySelector<HTMLElement>(`.mc[data-claim="${CSS.escape(c.claim)}"]`) : null;
  const prev = el?.dataset.verdict;
  if (el) el.dataset.verdict = "human-verified";
  claim = null;
  s.layers.drop("claim");
  try {
    const body: { verified: boolean; claims?: `cl_${string}`[] } = { verified: true };
    if (c.claim) body.claims = [c.claim as `cl_${string}`];
    const v = await s.api.call("POST /ws/:ws/doc/blocks/:block/verify", { params: { ws, block: c.block }, body });
    s.doc.upsertBlock(v);
  } catch (err) {
    if (el && prev) el.dataset.verdict = prev;
    s.bottom.toast({ id: "verify.failed", kind: "error", key: "toast.verifyFailed", params: { error: errorText(MitoriError.from(err).toData()) } });
  }
}

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
let spy = $state.raw<{ path: RepoPath; start: LineNo; end: LineNo } | null>(null);
$effect(() => {
  if (s.ctx.mode !== "code" || s.ctx.pin || !main || !loaded) return;
  let settle: ReturnType<typeof setTimeout> | null = null;
  const io = new IntersectionObserver(
    (entries) => {
      const first = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const cite = first?.target.querySelector<HTMLElement>("a.mcite")?.dataset.cite;
      if (!cite) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => (spy = parseCite(cite)), 100);
    },
    { rootMargin: "-18% 0px -62% 0px" },
  );
  for (const el of main.querySelectorAll(".blk")) io.observe(el);
  return () => io.disconnect();
});

// ---------------------------------------------------------------- reading-path progress (marker passes the bottom 20 %)
$effect(() => {
  if (!loaded || !main || !ws || !model) return;
  // progress belongs to the path chosen in the rail card (sessionStorage `mitori:path:<ws>`)
  const pathId = selectedPath(s.doc.outline, ws)?.id ?? DEFAULT_PATH;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const sec = (e.target as HTMLElement).dataset.read;
        if (!sec) continue;
        const key = STORAGE_KEYS.read(ws, pathId);
        const cur = getJson<Record<string, string>>("local", key) ?? {};
        if (!cur[sec]) {
          cur[sec] = new Date().toISOString();
          setJson("local", key, cur);
          s.ui.readTick++;
        }
      }
    },
    { rootMargin: "0px 0px -20% 0px" },
  );
  for (const el of main.querySelectorAll("[data-read]")) io.observe(el);
  return () => io.disconnect();
});

// tail of the running generation (`◐ 生成中 · modules · internal/session`, §4.3.9-6)
const streamTail = $derived.by(() => {
  const running = s.gen.tasks.filter((x) => x.state === "running");
  const last = running[running.length - 1];
  return last ? `${t(`gen.stage.${last.stage}`)} · ${last.target.id}` : null;
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
const marginView = $derived(ext?.margin ?? null);
</script>

{#snippet head(p: PagePart)}
  {@const st = ix ? subtreeStats(ix, p.node.id) : null}
  {#if p.top}
    <header class="sec-head" data-chrome>
      <!-- UI ≠ doc language: the note shares the § row (fixed height) so switching the UI language moves nothing -->
      <p class="sec-num">&sect;{p.num}{#if uiLang !== docLang}<span class="lang-note">{t("reader.translateBand")}</span>{/if}</p>
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
    {#if notGenerated && p.node.state !== "static_only"}
      <p class="gen-note" data-chrome>
        <span>{t("reader.notGenerated")}</span>
        {#if ws}<a class="btn btn-sec btn-s" href={HREFS.map(ws)}>{t("reader.seeEstimate")}</a>{/if}
      </p>
    {/if}
  {:else}
    <h2 class="sub" id={`sec-${p.node.id}`}><span class="hn">{p.num}</span><span data-user-content>{p.node.title}</span></h2>
  {/if}
  <span class="read-mark" data-read={p.node.id} aria-hidden="true"></span>
{/snippet}

<div class="body reader-body" style:grid-template-columns="{layout.rail}px minmax(0,1fr) {layout.ctxPlacement === 'column' ? layout.ctx : 0}px">
  <Rail mode={layout.railMode}>
    {#snippet top()}
      {#if s.doc.outline && !s.map.fallback}<Minimap page={model?.page ?? null} />{/if}
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
          onaction={(a) => compose(a === "comment" ? "note" : a === "explain" ? "question" : "change", gutter.block)}
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
          onterm={(e) => {
            term = e ? { id: e.term, anchorEl: e.anchorEl } : null;
            if (!e) return;
          }}
          onclaim={(e) => {
            claim = e;
            s.layers.open("popover", "claim", () => (claim = null));
          }}
          onhoverblock={onHoverBlock}
          onplaceholder={onPlaceholder}
          onmore={(ids) => (forced = new Set([...forced, ...ids]))}
          generating={s.gen.run?.state === "running" || s.gen.run?.state === "paused"}
          docLang={s.doc.lang}
          tail={streamTail}
          mutate={(apply) => s.doc.mutate(apply)}
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
    margin={marginView}
    review={reviewPanel}
    onwidth={(px) => {
      s.ctx.codeWidth = Math.max(420, Math.min(900, Math.round(px)));
      s.prefs.setCodeWidth(s.ctx.codeWidth);
    }}
  />
</div>

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
  />
{/if}
{#if term && termEntry && ws}
  <TermCard
    entry={termEntry}
    anchorEl={term.anchorEl}
    href={HREFS.doc(ws, "s12")}
    onenter={() => (termHover = true)}
    onleave={() => {
      termHover = false;
      setTimeout(() => !termHover && (term = null), 160);
    }}
  />
{/if}
{#if claim}
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
