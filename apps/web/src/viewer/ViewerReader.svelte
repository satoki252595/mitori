<!--
  The export's Reader (S2 without the loop): the SAME BlockHost / decorate / levels / peek / term card as the app's
  ReaderPage, fed from the payload. Read-only: no gutter, composer, margin cards or generation. Cite peeks come from
  `payload.cites` (static ±3 lines); a range that was not embedded says so.
-->
<script lang="ts">
import { type BlockId, type CitePeek as CitePeekData, type GlossaryEntry, type LineNo, type RepoPath, type SectionId } from "@mitori/core";
import { flushSync, onMount, untrack } from "svelte";
import BlockHost from "../reader/BlockHost.svelte";
import CitePeek from "../reader/CitePeek.svelte";
import { parseCite } from "../reader/code.ts";
import { applyLevel } from "../reader/decorate.ts";
import { blockVisibleImpl, permalinkTextImpl, stepLevel } from "../reader/levels.ts";
import { readingMinutes, subtreeStats } from "../reader/outline.ts";
import { buildPage, type PagePart, stepBlock } from "../reader/page.ts";
import { type Anchor, captureAnchor, restoreAnchor } from "../reader/scroll-anchor.ts";
import TermCard from "../reader/TermCard.svelte";
import { isComposingImpl } from "../shell/ime.ts";
import { t } from "../shell/index.ts";
import { typingTarget } from "./keys.ts";
import OmittedPeek from "./OmittedPeek.svelte";
import { formatHash } from "./route.ts";
import { useViewer } from "./state.svelte.ts";
import VerdictNote from "./VerdictNote.svelte";
import ViewerContext, { type About } from "./ViewerContext.svelte";

const v = useViewer();
const ix = v.index;
const route = $derived(v.route.name === "doc" ? v.route : null);
const section = $derived<SectionId>(route?.section ?? ix.pages[0] ?? "s0");
const page = $derived(v.pageOf(section));
const model = $derived(buildPage(ix, page, (id) => v.sections.get(id)));
const level = $derived(v.level);
let host: BlockHost | undefined = $state();
let main: HTMLElement | undefined = $state();
let focused = $state<BlockId | null>(null);
let forced = $state.raw<ReadonlySet<BlockId>>(new Set());
const empty = new Map();

// ---------------------------------------------------------------- first paint after a navigation
let paintedFor: string | null = null;
$effect(() => {
  const key = `${model.page}|${v.nav}`;
  if (paintedFor === key) return;
  paintedFor = key;
  untrack(() => {
    const r = route;
    requestAnimationFrame(() => {
      if (r?.block) focusBlock(r.block, true);
      else if (r && r.section !== model.page) document.querySelector(`[data-sec="${CSS.escape(r.section)}"]`)?.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
      if (!r?.block) (main?.querySelector("h1") as HTMLElement | null)?.focus({ preventScroll: true });
    });
    const n = ix.nodes.get(model.page);
    if (n) v.announce(t("reader.announce.page", { num: ix.numbers.get(model.page) ?? "", title: n.title }));
  });
});

// level: <details> defaults follow the level (CSS does everything else)
$effect(() => {
  const l = level;
  if (main) untrack(() => applyLevel(main as HTMLElement, l));
});

// a level switch keeps the first visible block where it is (AC-J20): the state calls this around the change
onMount(() => {
  v.levelTransition = () => {
    const a: Anchor | null = main ? captureAnchor(main) : null;
    return () => {
      if (!main) return;
      applyLevel(main, v.level);
      restoreAnchor(main, a, model.order);
    };
  };
  return () => {
    v.levelTransition = null;
  };
});

// ---------------------------------------------------------------- j / k
function isVisible(id: BlockId): boolean {
  if (forced.has(id)) return true;
  const b = v.blocks.get(id);
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
  history.replaceState(null, "", formatHash({ name: "doc", section, block: id }));
}

onMount(() => {
  const key = (e: KeyboardEvent) => {
    if (isComposingImpl(e) || v.route.name !== "doc" || v.paletteOpen || v.helpOpen || e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
    const next = (dir: 1 | -1) => {
      const id = stepBlock(model.order, focused, dir, isVisible);
      if (id) focusBlock(id, true);
    };
    if (e.key === "j") next(1);
    else if (e.key === "k") next(-1);
    else if (e.key === "-") v.setLevel(stepLevel(v.level, -1));
    else if (e.key === "=" || e.key === "+") v.setLevel(stepLevel(v.level, 1));
    else if (e.key === "0") v.setLevel("standard");
    else if (e.key === ".") v.showCites = !v.showCites;
    else if (e.key === "y") void permalink();
    else if (/^[1-9]$/.test(e.key)) {
      const target = ix.pages.filter((p) => !p.includes("/"))[Number(e.key) - 1];
      if (target) v.go({ name: "doc", section: target, block: null });
    } else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", key);
  return () => window.removeEventListener("keydown", key);
});

async function permalink() {
  const block = focused;
  const sec = block ? (ix.blockSection.get(block) ?? model.page) : model.page;
  const node = ix.nodes.get(sec);
  const el = block ? main?.querySelector(`.blk[data-b="${CSS.escape(block)}"] a.mcite .cs`) : null;
  const url = `${location.href.split("#")[0]}${formatHash({ name: "doc", section: sec, block })}`;
  const text = permalinkTextImpl({
    section: sec,
    title: `${ix.numbers.get(sec) ?? ""} ${node?.title ?? ""}`.trim(),
    ...(el?.textContent ? { cite: el.textContent } : {}),
    url,
  });
  try {
    await navigator.clipboard.writeText(text);
    v.announce(t("export.copied"));
  } catch {
    /* no clipboard (file:// in some browsers): the URL is in the address bar */
  }
}

// ---------------------------------------------------------------- cite peek / term card / verdict note
type PeekState = { data: CitePeekData | null; cite: string; anchorEl: HTMLElement; claimId: string | null; pinned: boolean };
let peek = $state.raw<PeekState | null>(null);
let peekHover = false;
let peekTimer: ReturnType<typeof setTimeout> | null = null;

function citeKey(cite: string, blob: string): string {
  return `${cite}@${blob.slice(0, 7)}`;
}

function closePeekSoon() {
  if (peekTimer) clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (!peekHover && !peek?.pinned) closePeek();
  }, 160);
}
function closePeek() {
  peek = null;
  main?.querySelector("a.mcite.on, a.fcite.on")?.classList.remove("on");
}

function onCite(e: { cite: string; blob: string; anchorEl: HTMLElement; via: "hover" | "focus" | "click" | "leave" }) {
  if (e.via === "leave") return closePeekSoon();
  if (peekTimer) clearTimeout(peekTimer);
  main?.querySelector("a.mcite.on, a.fcite.on")?.classList.remove("on");
  e.anchorEl.classList.add("on");
  const data = v.payload.cites[citeKey(e.cite, e.blob)] ?? null;
  peek = { data, cite: e.cite, anchorEl: e.anchorEl, claimId: claimOfCite(e.anchorEl, e.cite, e.blob), pinned: e.via === "click" };
}

/** The claim a chip belongs to: the chips follow their claim's span (or sit at the paragraph end), so look the cite up in the block. */
function claimOfCite(chip: HTMLElement, cite: string, blob: string): string | null {
  const inside = (chip.closest(".mc") as HTMLElement | null)?.dataset.claim;
  if (inside) return inside;
  const block = chip.closest<HTMLElement>(".blk[data-b]")?.dataset.b;
  const b = block ? v.blocks.get(block as BlockId) : undefined;
  const hit = b?.claimViews.find((c) => c.cites.some((ct) => `${ct.path}:${ct.start}-${ct.end}` === cite && ct.blob.startsWith(blob.slice(0, 7))));
  return hit?.id ?? null;
}

const peekClaim = $derived(peek?.claimId ? (v.claims.get(peek.claimId) ?? null) : null);

let term = $state.raw<{ id: string; anchorEl: HTMLElement } | null>(null);
let termHover = false;
const termEntry = $derived<GlossaryEntry | null>(term ? (v.terms.get(term.id) ?? null) : null);

let note = $state.raw<{ verdict: string; anchorEl: HTMLElement } | null>(null);

onMount(() => {
  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || isComposingImpl(e)) return;
    if (peek || term || note) {
      closePeek();
      term = null;
      note = null;
    }
  };
  const down = (e: PointerEvent) => {
    const el = e.target as Element;
    if (!(peek || note) || el.closest(".pop, a.mcite, a.fcite, .mc, button.vsum, button.cite-end")) return;
    closePeek();
    note = null;
  };
  window.addEventListener("keydown", esc);
  window.addEventListener("pointerdown", down);
  return () => {
    window.removeEventListener("keydown", esc);
    window.removeEventListener("pointerdown", down);
  };
});

// ---------------------------------------------------------------- 「この節について」
let citedFiles = $state.raw<About["files"]>([]);
$effect(() => {
  void model.page;
  if (!main) return;
  const root = main;
  const raf = requestAnimationFrame(() => {
    const by = new Map<string, { path: RepoPath; n: number; start: LineNo; end: LineNo; cite: string; blob: string }>();
    for (const a of root.querySelectorAll<HTMLElement>("a.mcite[data-cite], a.fcite[data-cite]")) {
      const c = parseCite(a.dataset.cite ?? "");
      if (!c) continue;
      const cur = by.get(c.path);
      if (cur) cur.n++;
      else by.set(c.path, { path: c.path, n: 1, start: c.start, end: c.end, cite: a.dataset.cite ?? "", blob: a.dataset.blob ?? "" });
    }
    citedFiles = [...by.values()].sort((a, b) => b.n - a.n || (a.path < b.path ? -1 : 1));
  });
  return () => cancelAnimationFrame(raf);
});

const about = $derived.by<About>(() => {
  const st = subtreeStats(ix, model.page);
  return {
    minutes: readingMinutes(model.parts[0]?.node.readingSec ?? 0),
    blocks: model.parts.reduce((n, p) => n + p.blocks.length, 0),
    verified: st.verified,
    inferred: st.inferred,
    stale: st.stale,
    staticOnly: model.parts.every((p) => p.node.state === "static_only"),
    files: citedFiles,
  };
});

function openFile(f: About["files"][number], el: HTMLElement) {
  const data = v.payload.cites[citeKey(f.cite, f.blob)] ?? null;
  peek = { data, cite: f.cite, anchorEl: el, claimId: null, pinned: true };
}

const next = $derived.by(() => {
  const i = ix.pages.indexOf(model.page);
  return i >= 0 ? (ix.pages[i + 1] ?? null) : null;
});
</script>

{#snippet head(p: PagePart)}
  {@const st = subtreeStats(ix, p.node.id)}
  {#if p.top}
    <header class="sec-head" data-chrome>
      <p class="sec-num">&sect;{p.num}</p>
      <h1 tabindex="-1" data-user-content>{p.node.title}</h1>
      <p class="sec-meta">
        <span>{t("reader.meta.minutes", { n: readingMinutes(p.node.readingSec) })}</span>
        {#if st.verified > 0}<span class="sep" aria-hidden="true">&middot;</span><span>{t("reader.meta.verified", { n: st.verified })}</span>{/if}
        {#if st.inferred > 0}<span class="sep" aria-hidden="true">&middot;</span><span class="guess">{t("reader.meta.inferred", { n: st.inferred })}</span>{/if}
        {#if st.stale > 0}<span class="sep" aria-hidden="true">&middot;</span><span class="stale">{t("reader.meta.stale", { n: st.stale })}</span>{/if}
        {#if p.node.state === "static_only"}<span class="sep" aria-hidden="true">&middot;</span><span class="static-tag">{t("reader.meta.static")}</span>{/if}
      </p>
    </header>
  {:else}
    <h2 class="sub" id={`sec-${p.node.id}`}><span class="hn">{p.num}</span><span data-user-content>{p.node.title}</span></h2>
  {/if}
{/snippet}

<main id="main" class="doc" tabindex="-1" bind:this={main} lang={v.docLang}>
    <div class="doc-col">
      <BlockHost
        bind:this={host}
        page={model}
        {level}
        streaming={empty}
        {focused}
        {forced}
        {head}
        oncite={onCite}
        onterm={(e) => (term = e ? { id: e.term, anchorEl: e.anchorEl } : null)}
        onclaim={(e) => (note = { verdict: (e.anchorEl.closest(".mc") as HTMLElement | null)?.dataset.verdict ?? "inferred", anchorEl: e.anchorEl })}
        onhoverblock={() => {}}
        onmore={(ids) => (forced = new Set([...forced, ...ids]))}
        onread={(sec) => v.markRead(sec)}
        generating={false}
        docLang={v.docLang}
        codeHref={() => "#c"}
      />
      {#if next}
        <nav class="pager" aria-label={t("reader.pager")} data-chrome>
          <a href={formatHash({ name: "doc", section: next, block: null })}>
            <span class="k">{t("reader.next")}</span>
            <span class="t">&sect;{ix.numbers.get(next)} <span data-user-content>{ix.nodes.get(next)?.title}</span></span>
          </a>
        </nav>
      {/if}
    </div>
</main>
<ViewerContext {about} onfile={openFile} />

{#if peek}
  {#if peek.data}
    <CitePeek
      data={peek.data}
      checks={peekClaim?.checks ?? null}
      precision={peekClaim?.cites[0]?.precision ?? "exact"}
      anchorEl={peek.anchorEl}
      onenter={() => (peekHover = true)}
      onleave={() => {
        peekHover = false;
        closePeekSoon();
      }}
    />
  {:else}
    <OmittedPeek
      cite={peek.cite}
      anchorEl={peek.anchorEl}
      onenter={() => (peekHover = true)}
      onleave={() => {
        peekHover = false;
        closePeekSoon();
      }}
    />
  {/if}
{/if}
{#if term && termEntry}
  <TermCard
    entry={termEntry}
    anchorEl={term.anchorEl}
    href={formatHash({ name: "doc", section: "s12", block: null })}
    onenter={() => (termHover = true)}
    onleave={() => {
      termHover = false;
      setTimeout(() => !termHover && (term = null), 160);
    }}
  />
{/if}
{#if note}
  <VerdictNote verdict={note.verdict} anchorEl={note.anchorEl} onclose={() => (note = null)} />
{/if}

<style>
  .doc-col {
    position: relative;
  }
</style>
