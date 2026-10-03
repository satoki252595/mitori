<!--
  BlockHost (contract `BlockHostProps`, ux.md §12.7): server block HTML through {@html} inside one client wrapper
  per block, ONE delegated listener set on the root (≤ 8: pointerover/out, focusin/out, click, toggle), no per-line
  or per-block components. Long pages (> virtualizeBlocks) render windows of `blockWindow` blocks, viewport ± 1
  window, spacers elsewhere (ux.md §12.8).
-->
<script lang="ts">
import type { BlockId, BlockView, GlossaryId, ReaderLevel, SectionId } from "@mitori/core";
import { onMount, untrack } from "svelte";
import { type StreamingSection, UI_THRESHOLDS } from "../contract.ts";
import { t } from "../shell/index.ts";
import { decorateBlock } from "./decorate.ts";
import { l3Runs, type PageModel } from "./page.ts";
import { estimateBlockPx, sum, visibleWindows } from "./virtual.ts";

let {
  page,
  level,
  streaming,
  focused,
  forced,
  oncite,
  onterm,
  onclaim,
  onhoverblock,
  onplaceholder,
  onmore,
  head,
}: {
  page: PageModel;
  level: ReaderLevel;
  streaming: ReadonlyMap<SectionId, StreamingSection>;
  focused: BlockId | null;
  forced: ReadonlySet<BlockId>;
  oncite: (e: { cite: string; blob: string; anchorEl: HTMLElement; via: "hover" | "focus" | "click" | "leave" }) => void;
  onterm: (e: { term: GlossaryId; anchorEl: HTMLElement } | null) => void;
  onclaim: (e: { block: BlockId; claim: string | null; anchorEl: HTMLElement }) => void;
  onhoverblock: (b: BlockId | null, el: HTMLElement | null) => void;
  onplaceholder: (section: SectionId) => void;
  onmore: (ids: BlockId[]) => void;
  head: import("svelte").Snippet<[import("./page.ts").PagePart]>;
} = $props();

let root: HTMLDivElement | undefined = $state();

// ---------------------------------------------------------------- rows + windowing
type Row =
  | { k: "head"; key: string; part: number }
  | { k: "chip"; key: string; ids: BlockId[] }
  | { k: "blk"; key: string; b: BlockView }
  | { k: "stream"; key: string; section: SectionId };

const partRows = $derived(
  page.parts.map((p, i) => {
    const out: Row[] = [{ k: "head", key: `h:${p.node.id}`, part: i }];
    const runs = l3Runs(p.blocks);
    const ids = p.blocks.map((b) => b.id);
    p.blocks.forEach((b, j) => {
      const n = runs.get(b.id);
      if (n) out.push({ k: "chip", key: `c:${b.id}`, ids: ids.slice(j, j + n) });
      out.push({ k: "blk", key: b.id, b });
    });
    if (p.node.state === "pending" || p.node.state === "generating" || p.node.state === "partial" || streaming.has(p.node.id))
      out.push({ k: "stream", key: `s:${p.node.id}`, section: p.node.id });
    return out;
  }),
);
const rows = $derived(partRows.flat());

const virtual = $derived(page.total > UI_THRESHOLDS.virtualizeBlocks);
const W = UI_THRESHOLDS.blockWindow;
/** Row index ranges of each window (by block count). */
const windows = $derived.by(() => {
  if (!virtual) return [{ from: 0, to: rows.length }];
  const out: { from: number; to: number }[] = [];
  let from = 0;
  let blocks = 0;
  rows.forEach((r, i) => {
    if (r.k === "blk") blocks++;
    if (blocks === W && i + 1 < rows.length) {
      out.push({ from, to: i + 1 });
      from = i + 1;
      blocks = 0;
    }
  });
  out.push({ from, to: rows.length });
  return out;
});
let heights = $state.raw<number[]>([]);
let range = $state({ first: 0, last: 2 });
const measured = new Map<number, number>();

$effect(() => {
  const ws = windows;
  untrack(() => {
    heights = ws.map(
      (w, i) =>
        measured.get(i) ?? rows.slice(w.from, w.to).reduce((n, r) => n + (r.k === "blk" ? estimateBlockPx(r.b.readingSec) : r.k === "head" ? 140 : 40), 0),
    );
  });
});

function recompute() {
  if (!virtual || !root) return;
  const top = root.getBoundingClientRect().top + window.scrollY;
  const r = visibleWindows(heights, top, window.scrollY, window.scrollY + window.innerHeight);
  if (r.first !== range.first || r.last !== range.last) range = r;
}

/** Make sure the window holding a block is mounted (j/k, hash jumps). */
export function ensureMounted(id: BlockId): void {
  if (!virtual) return;
  const i = rows.findIndex((r) => r.k === "blk" && r.b.id === id);
  const w = windows.findIndex((x) => i >= x.from && i < x.to);
  if (w >= 0 && (w < range.first || w > range.last)) range = { first: Math.max(0, w - 1), last: Math.min(windows.length - 1, w + 1) };
}

$effect(() => {
  if (!virtual) return;
  let raf = 0;
  const on = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(recompute);
  };
  window.addEventListener("scroll", on, { passive: true });
  window.addEventListener("resize", on, { passive: true });
  on();
  return () => {
    window.removeEventListener("scroll", on);
    window.removeEventListener("resize", on);
    cancelAnimationFrame(raf);
  };
});

function measure(node: HTMLElement, index: number) {
  const ro = new ResizeObserver(() => {
    const h = node.offsetHeight;
    if (h > 0 && measured.get(index) !== h) {
      measured.set(index, h);
      heights = heights.with(index, h);
    }
  });
  ro.observe(node);
  return { destroy: () => ro.disconnect() };
}

// ---------------------------------------------------------------- decoration (once per block mount / html change)
const text = { citeEnd: (n: number) => t("reader.citeEnd", { n }), verifyLabel: t("reader.checkClaim") };
function deco(node: HTMLElement, b: BlockView) {
  decorateBlock(
    node,
    b,
    untrack(() => level),
    text,
  );
  return {
    update(nb: BlockView) {
      decorateBlock(
        node,
        nb,
        untrack(() => level),
        text,
      );
    },
  };
}

// ---------------------------------------------------------------- delegated events (≤ 8 listeners on the root)
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverBlock: HTMLElement | null = null;

onMount(() => {
  const el = root;
  if (!el) return;
  const over = (e: PointerEvent) => {
    const tg = e.target as Element;
    const cite = tg.closest?.("a.mcite") as HTMLElement | null;
    if (cite) {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(
        () => oncite({ cite: cite.dataset.cite ?? "", blob: cite.dataset.blob ?? "", anchorEl: cite, via: "hover" }),
        UI_THRESHOLDS.hoverCardMs,
      );
    }
    const term = tg.closest?.("abbr.mterm") as HTMLElement | null;
    if (term) {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => onterm({ term: (term.dataset.term ?? "") as GlossaryId, anchorEl: term }), UI_THRESHOLDS.hoverCardMs);
    }
    const blk = tg.closest?.(".blk") as HTMLElement | null;
    if (blk !== hoverBlock) {
      hoverBlock = blk;
      onhoverblock((blk?.dataset.b as BlockId | undefined) ?? null, blk);
    }
  };
  const out = (e: PointerEvent) => {
    const to = e.relatedTarget as Element | null;
    const from = e.target as Element;
    if (from.closest?.("a.mcite, abbr.mterm") && !to?.closest?.("a.mcite, abbr.mterm")) {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = null;
      oncite({ cite: "", blob: "", anchorEl: from as HTMLElement, via: "leave" });
    }
    if (!to || !el.contains(to)) {
      hoverBlock = null;
      onhoverblock(null, null);
    }
  };
  const focusin = (e: FocusEvent) => {
    const tg = e.target as Element;
    const cite = tg.closest?.("a.mcite") as HTMLElement | null;
    if (cite?.matches(":focus-visible")) oncite({ cite: cite.dataset.cite ?? "", blob: cite.dataset.blob ?? "", anchorEl: cite, via: "focus" });
    const term = tg.closest?.("abbr.mterm") as HTMLElement | null;
    if (term) onterm({ term: (term.dataset.term ?? "") as GlossaryId, anchorEl: term });
  };
  const focusout = (e: FocusEvent) => {
    const tg = e.target as Element;
    if (tg.closest?.("a.mcite") && !(e.relatedTarget as Element | null)?.closest?.(".peek"))
      oncite({ cite: "", blob: "", anchorEl: tg as HTMLElement, via: "leave" });
  };
  const click = (e: MouseEvent) => {
    const tg = e.target as Element;
    const cite = tg.closest?.("a.mcite") as HTMLElement | null;
    if (cite && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) {
      e.preventDefault();
      oncite({ cite: cite.dataset.cite ?? "", blob: cite.dataset.blob ?? "", anchorEl: cite, via: "click" });
      return;
    }
    const end = tg.closest?.("button.cite-end") as HTMLElement | null;
    if (end) {
      const first = end.closest(".mb")?.querySelector("a.mcite") as HTMLElement | null;
      if (first) oncite({ cite: first.dataset.cite ?? "", blob: first.dataset.blob ?? "", anchorEl: end, via: "click" });
      return;
    }
    const claim = tg.closest?.(".mc[data-verdict='inferred'], .mc[data-verdict='unsupported'], .mc[data-verdict='stale'], button.vsum") as HTMLElement | null;
    if (claim) {
      const blk = claim.closest(".blk") as HTMLElement | null;
      const c = claim.matches(".mc")
        ? claim
        : (blk?.querySelector(".mc[data-verdict='inferred'], .mc[data-verdict='unsupported'], .mc[data-verdict='stale']") as HTMLElement | null);
      if (blk) onclaim({ block: blk.dataset.b as BlockId, claim: c?.dataset.claim ?? null, anchorEl: claim });
      return;
    }
    const more = tg.closest?.("button.more-chip") as HTMLElement | null;
    if (more) {
      onmore((more.dataset.ids ?? "").split(",") as BlockId[]);
      return;
    }
    const ph = tg.closest?.("button[data-ph]") as HTMLElement | null;
    if (ph) onplaceholder(ph.dataset.ph as SectionId);
  };
  const toggle = () => {
    /* <details> open/close changes heights: margin re-layout hook point (WP-10b) */
  };
  el.addEventListener("pointerover", over);
  el.addEventListener("pointerout", out);
  el.addEventListener("focusin", focusin);
  el.addEventListener("focusout", focusout);
  el.addEventListener("click", click);
  el.addEventListener("toggle", toggle, true);
  return () => {
    el.removeEventListener("pointerover", over);
    el.removeEventListener("pointerout", out);
    el.removeEventListener("focusin", focusin);
    el.removeEventListener("focusout", focusout);
    el.removeEventListener("click", click);
    el.removeEventListener("toggle", toggle, true);
    if (hoverTimer) clearTimeout(hoverTimer);
  };
});
</script>

{#snippet rowView(r: Row)}
  {#if r.k === "head"}
    {@render head(page.parts[r.part] as import("./page.ts").PagePart)}
  {:else if r.k === "chip"}
    <button type="button" class="more-chip" data-ids={r.ids.join(",")}>{t("reader.more", { n: r.ids.length })}</button>
  {:else if r.k === "blk"}
    {#if r.b.status === "placeholder"}
      <div class="blk ph-wrap" data-b={r.b.id} data-depth={r.b.depth} data-kind={r.b.kind} data-ln={r.b.mdLine} tabindex="-1">
        <div class="ph">
          <div>{@html r.b.html}</div>
          <button type="button" class="btn btn-sec btn-s" data-ph={r.b.section}>{t("reader.placeholder.generate")}</button>
        </div>
      </div>
    {:else}
      <div
        class="blk"
        class:focus={focused === r.b.id}
        class:thread={r.b.threads.open > 0}
        class:force={forced.has(r.b.id)}
        data-b={r.b.id}
        data-depth={r.b.depth}
        data-kind={r.b.kind}
        data-ln={r.b.mdLine}
        tabindex="-1"
        use:deco={r.b}
      >
        {@html r.b.html}
      </div>
    {/if}
  {:else if r.k === "stream"}
    {@const st = streaming.get(r.section)}
    <div class="mstream" style:--reserve="{st?.reservedPx ?? 600}px" data-section={r.section}>
      <p class="stream-note"><span class="caret" aria-hidden="true"></span>{t("reader.generating")}</p>
      {#if st?.partial}<p class="partial">{st.partial}<span class="caret" aria-hidden="true"></span></p>{/if}
    </div>
  {/if}
{/snippet}

<div class="reader-root prose" bind:this={root}>
  {#if !virtual}
    {#each page.parts as p, pi (p.node.id)}
      <section class="sec" class:cv={!p.top && !p.blocks.some((b) => b.kind === "diagram")} data-sec={p.node.id}>
        {#each partRows[pi] ?? [] as r (r.key)}{@render rowView(r)}{/each}
      </section>
    {/each}
  {:else}
    {@const lead = sum(heights, 0, range.first)}
    {@const tail = sum(heights, range.last + 1, heights.length)}
    {#if lead > 0}<div class="bwin-sp" style:height="{lead}px" aria-hidden="true"></div>{/if}
    {#each windows.slice(range.first, range.last + 1) as w, j (range.first + j)}
      <div class="bwin" use:measure={range.first + j}>
        {#each rows.slice(w.from, w.to) as r (r.key)}{@render rowView(r)}{/each}
      </div>
    {/each}
    {#if tail > 0}<div class="bwin-sp" style:height="{tail}px" aria-hidden="true"></div>{/if}
  {/if}
</div>
