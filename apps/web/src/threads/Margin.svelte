<!--
  Margin column content (contract `UiExtension.margin`, ux.md §6.3, Editorial §4.1 + JUDGEMENT X14): the Composer,
  job / ready cards and thread cards of the page, each at the height of its anchor block, placed by
  `layoutMarginCards` (push-down around the active card; resolved then old open cards collapse to the 32 px
  one-liner beyond 8 cards or 480 px of displacement). Heights come from ResizeObservers; every re-layout is one rAF.
  Blocks with a running job get the AI-working band (`.blk.working`, §4.3.4).
-->
<script lang="ts">
import type { BlockId, ThreadSummary } from "@mitori/core";
import { onMount, untrack } from "svelte";
import Composer from "../composer/Composer.svelte";
import type { MarginCardInput, MarginCardPlacement } from "../contract.ts";
import { layoutMarginCards } from "../reader/index.ts";
import { currentLayout, useStores } from "../stores/app.svelte.ts";
import CardHost from "./CardHost.svelte";
import { loopOf } from "./loop.svelte.ts";

let { page }: { page: string } = $props();

const s = useStores();
const loop = loopOf(s);
let root: HTMLDivElement | undefined = $state();
const heights = new Map<string, number>();
let placed = $state.raw<ReadonlyMap<string, MarginCardPlacement>>(new Map());
let tall = $state(0);
/** Cards placed at least once: only those animate their moves (a new card appears in place). */
let settled = $state.raw<ReadonlySet<string>>(new Set());
const inColumn = $derived(currentLayout(s).ctxPlacement === "column" && s.ctx.mode === "margin");

function pageOf(block: BlockId | undefined): string | null {
  if (!block) return null;
  const sec = s.doc.index?.blockSection.get(block);
  return sec ? (s.doc.index?.pageOf.get(sec) ?? sec) : null;
}

interface Card {
  id: string;
  block: BlockId;
  kind: "composer" | "thread";
  thread?: ThreadSummary;
  age: number;
  collapsible: MarginCardInput["collapsible"];
}

const composer = $derived(loop.composer && pageOf(loop.composer.target.block) === page ? loop.composer : null);

const cards = $derived.by<Card[]>(() => {
  const out: Card[] = [];
  const threads = [...s.review.threads.values()]
    .filter((t) => t.anchor.doc && pageOf(t.anchor.doc.block) === page)
    .filter((t) => (t.state !== "draft" || t.intent === "doc_edit") && !loop.undo.discarding.has(t.id))
    .filter((t) => !(loop.hideResolved && t.state === "resolved"))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  threads.forEach((t, i) => {
    out.push({
      id: t.id,
      block: t.anchor.doc?.block as BlockId,
      kind: "thread",
      thread: t,
      age: threads.length - i,
      collapsible: t.state === "resolved" || t.state === "answered" || t.state === "applied" ? "resolved" : t.state === "open" ? "open" : "never",
    });
  });
  if (composer) out.push({ id: composer.tempKey, block: composer.target.block, kind: "composer", age: 0, collapsible: "never" });
  return out;
});

// ------------------------------------------------------------------------------- layout (one rAF)
let raf = 0;
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(layout);
}

function layout() {
  if (!root) return;
  const top = root.getBoundingClientRect().top;
  const inputs: MarginCardInput[] = [];
  for (const c of cards) {
    const el = document.querySelector<HTMLElement>(`.reader-root .blk[data-b="${CSS.escape(c.block)}"]`);
    const visible = !!el && el.getClientRects().length > 0;
    inputs.push({
      id: c.id,
      ideal: visible && el ? el.getBoundingClientRect().top - top : 0,
      height: heights.get(c.id) ?? 96,
      active: loop.active === c.id || (c.kind === "composer" && loop.active === null),
      collapsible: c.collapsible,
      age: c.age,
      visible,
    });
  }
  const out = layoutMarginCards(inputs);
  placed = new Map(out.map((p) => [p.id, p]));
  tall = out.reduce((m, p) => (p.hidden ? m : Math.max(m, p.y + (p.collapsed ? 32 : (heights.get(p.id) ?? 96)))), 0);
  const ids = out.filter((p) => !p.hidden).map((p) => p.id);
  if (ids.some((id) => !settled.has(id))) requestAnimationFrame(() => (settled = new Set(ids)));
}

$effect(() => {
  // re-layout when the cards, the active card or the reader level change
  void cards;
  void loop.active;
  void s.doc.level;
  untrack(schedule);
});

onMount(() => {
  const main = document.querySelector(".reader-root") ?? document.querySelector("main");
  const ro = new ResizeObserver(schedule);
  if (main) ro.observe(main);
  window.addEventListener("resize", schedule, { passive: true });
  // <details> open / close inside the prose changes block positions
  const toggle = () => schedule();
  main?.addEventListener("toggle", toggle, true);
  const k = s.keys;
  const offs = [
    k.on("thread.next", () => step(1)),
    k.on("thread.prev", () => step(-1)),
    k.on("threads.hideResolved", () => (loop.hideResolved = !loop.hideResolved)),
  ];
  return () => {
    ro.disconnect();
    window.removeEventListener("resize", schedule);
    main?.removeEventListener("toggle", toggle, true);
    cancelAnimationFrame(raf);
    for (const off of offs) off();
  };
});

function measure(node: HTMLElement, id: string) {
  const ro = new ResizeObserver(() => {
    const h = node.offsetHeight;
    if (h > 0 && heights.get(id) !== h) {
      heights.set(id, h);
      schedule();
    }
  });
  ro.observe(node);
  return { destroy: () => ro.disconnect() };
}

/** `]` / `[`: next / previous card by position; the card expands, becomes active and its block scrolls in. */
function step(dir: 1 | -1) {
  const list = cards.filter((c) => !placed.get(c.id)?.hidden).sort((a, b) => (placed.get(a.id)?.y ?? 0) - (placed.get(b.id)?.y ?? 0));
  if (!list.length) return;
  const i = list.findIndex((c) => c.id === loop.active);
  const next = list[i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length] as Card;
  loop.active = next.id;
  document.querySelector(`.reader-root .blk[data-b="${CSS.escape(next.block)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  requestAnimationFrame(() =>
    root
      ?.querySelector<HTMLElement>(`[data-card="${CSS.escape(next.id)}"] button, [data-card="${CSS.escape(next.id)}"] textarea`)
      ?.focus({ preventScroll: true }),
  );
}

// ------------------------------------------------------------------------------- AI-working band on blocks
const working = $derived.by(() => {
  const set = new Set<BlockId>();
  for (const c of cards) {
    if (c.kind !== "thread" || !c.thread) continue;
    const j = loop.jobOf(c.thread.id);
    if ((j && loop.isRunning(j)) || loop.pendingOf(c.thread.id)?.phase === "sending") set.add(c.block);
  }
  return set;
});
let marked = new Set<BlockId>();
$effect(() => {
  const now = working;
  untrack(() => {
    for (const b of marked) if (!now.has(b)) document.querySelector(`.blk[data-b="${CSS.escape(b)}"]`)?.classList.remove("working");
    for (const b of now) document.querySelector(`.blk[data-b="${CSS.escape(b)}"]`)?.classList.add("working");
    marked = new Set(now);
  });
});
</script>

<div class="mg" bind:this={root} style:min-height="{tall + 48}px" data-chrome>
  {#each cards as c (c.id)}
    {@const p = placed.get(c.id)}
    <div class="slot" data-card={c.id} class:hidden={!p || p.hidden} class:active={loop.active === c.id} class:settled={settled.has(c.id)} style:transform="translateY({p?.y ?? 0}px)" use:measure={c.id}>
      {#if c.kind === "composer" && composer}
        {#if inColumn}<Composer session={composer} placement="margin" showIds={s.doc.level === "expert"} />{/if}
      {:else if c.thread}
        <CardHost thread={c.thread} collapsed={!!p?.collapsed && loop.active !== c.id} active={loop.active === c.id} onexpand={() => (loop.active = c.id)} />
      {/if}
    </div>
  {/each}
</div>

<style>
  .mg {
    position: relative;
    padding: 0 20px;
  }
  .slot {
    position: absolute;
    left: 20px;
    right: 20px;
    top: 0;
    animation: card-in var(--dur-card) ease-out;
  }
  .slot.settled {
    transition: transform var(--dur-move) var(--ease-out);
  }
  .slot.active {
    z-index: var(--z-local);
  }
  .slot.hidden {
    visibility: hidden;
  }
  @keyframes card-in {
    from {
      opacity: 0;
    }
  }
</style>
