<!--
  Floating selection toolbar (contract `SelectionToolbarProps`, ux.md §6.1 R1, JUDGEMENT 03a): a selection of ≥ 2
  chars — or one CJK character (UXP-37) — inside ONE block's body shows 「コメント C · 説明して E · 修正して F │ P │ Y
  │ ≈{k}」 46 px above it (below when there is no room, always below on touch). One `selectionchange` listener,
  batched per frame. Buttons keep the selection (`mousedown` default prevented). The keys c / e / f / p / y act on
  the selection through the key registry while the toolbar is shown.
-->
<script lang="ts">
import { HREFS } from "@mitori/core";
import { onMount } from "svelte";
import { UI_THRESHOLDS } from "../contract.ts";
import { permalinkText } from "../reader/index.ts";
import { copyText } from "../shell/clipboard.ts";
import Icon from "../shell/Icon.svelte";
import { fmtTokens, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { selectionCounts } from "../threads/anchor-text.ts";
import { anchorFromRange } from "../threads/dom-anchor.ts";
import { loopOf } from "../threads/loop.svelte.ts";
import { anchorOfTarget, targetOf } from "./targets.ts";

const s = useStores();
const loop = loopOf(s);
type Sel = NonNullable<ReturnType<typeof anchorFromRange>>;
let sel = $state.raw<Sel | null>(null);
let pos = $state<{ top: number; left: number; below: boolean } | null>(null);
let el: HTMLDivElement | undefined = $state();
const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

const fixTokens = $derived.by(() => {
  const c = sel ? loop.estimateHint.get(sel.block) : undefined;
  return c ?? null;
});

function read(): void {
  const ds = document.getSelection();
  if (!ds || ds.rangeCount === 0 || ds.isCollapsed || loop.composer) {
    clear();
    return;
  }
  const range = ds.getRangeAt(0);
  const root = (
    range.commonAncestorContainer.nodeType === 1 ? (range.commonAncestorContainer as Element) : range.commonAncestorContainer.parentElement
  )?.closest(".reader-root");
  const startMb = (range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest(".mb");
  if (!startMb || !(root ?? startMb.closest(".reader-root"))) {
    clear();
    return;
  }
  if (!selectionCounts(ds.toString(), UI_THRESHOLDS.selectionMinChars, UI_THRESHOLDS.selectionMinCharsCjk)) {
    clear();
    return;
  }
  const a = anchorFromRange(range);
  if (!a) {
    clear();
    return;
  }
  sel = a;
  place(a.range.getBoundingClientRect());
  if (!s.layers.isOpen("seltool")) s.layers.open("seltool", "seltool", () => document.getSelection()?.removeAllRanges());
}

function place(r: DOMRect): void {
  const w = el?.offsetWidth ?? 420;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const off = 46;
  const above = r.top - off;
  const below = coarse || above < 52 + 4;
  pos = { top: below ? r.bottom + (coarse ? 10 : 8) : above, left, below };
}

function clear(): void {
  if (!sel) return;
  sel = null;
  pos = null;
  s.layers.drop("seltool");
}

let raf = 0;
onMount(() => {
  const on = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(read);
  };
  document.addEventListener("selectionchange", on);
  const scroll = () => {
    if (sel) place(sel.range.getBoundingClientRect());
  };
  window.addEventListener("scroll", scroll, { passive: true });
  const k = s.keys;
  const offs = [
    k.on("act.comment", (e) => act("comment", e)),
    k.on("act.explain", (e) => act("explain", e)),
    k.on("act.fix", (e) => act("fix", e)),
    k.on("copy.prompt", (e) => act("prompt", e)),
  ];
  return () => {
    document.removeEventListener("selectionchange", on);
    window.removeEventListener("scroll", scroll);
    cancelAnimationFrame(raf);
    for (const off of offs) off();
    s.layers.drop("seltool");
  };
});

/** A key with a live selection acts on it; the Reader's focused-block path covers the rest. */
function act(a: "comment" | "explain" | "fix" | "prompt" | "permalink", e?: KeyboardEvent): void {
  const cur = sel;
  if (!cur) {
    if (a === "prompt") void promptForFocused();
    return;
  }
  const target = targetOf(s, cur);
  if (!target) return;
  // the Reader answers the same key for its focused block, or with a one-time hint: the selection wins
  loop.selectionClaim = Date.now();
  setTimeout(() => s.bottom.dismiss("hint.noTarget"), 0);
  if (a === "prompt") {
    void loop.copyPrompt(anchorOfTarget(target), "", "change");
    return;
  }
  if (a === "permalink") {
    void permalink(target.section, target.fileLine);
    return;
  }
  void loop.openComposer(target, a === "comment" ? "note" : a === "explain" ? "question" : "change", e?.timeStamp, cur.range);
  clear();
}

async function promptForFocused(): Promise<void> {
  const block = s.router.focusedBlock?.();
  if (!block) return;
  const { targetOfBlock } = await import("./targets.ts");
  const target = targetOfBlock(s, block as `b_${string}`, null);
  if (target) await loop.copyPrompt(anchorOfTarget(target), "", "change");
}

async function permalink(section: string, cite: string | null): Promise<void> {
  const ix = s.doc.index;
  const ws = s.workspace.key;
  if (!ix || !ws || !sel) return;
  const node = ix.nodes.get(section as never);
  const info = s.workspace.status?.info;
  const b = sel.block;
  const url = info?.docId ? `mitori open ${info.docId}#${b}` : `${location.origin}${HREFS.doc(ws, section as never, b)}`;
  const title = `${ix.numbers.get(section as never) ?? ""} ${node?.title ?? ""}`.trim();
  await copyText(permalinkText({ section: section as never, title, ...(cite ? { cite } : {}), url }), s, "copy.permalink");
}

const keep = (e: MouseEvent) => e.preventDefault();
</script>

{#if sel && pos}
  <div
    class="seltool"
    class:below={pos.below}
    bind:this={el}
    role="toolbar"
    aria-label={t("composer.seltool.label")}
    style:top="{pos.top}px"
    style:left="{pos.left}px"
    data-chrome
  >
    <button type="button" onmousedown={keep} onclick={() => act("comment")}><Icon name="comment" size={15} /><span>{t("composer.seltool.comment")}</span><kbd>C</kbd></button>
    <button type="button" onmousedown={keep} onclick={() => act("explain")}><Icon name="explain" size={15} /><span>{t("composer.seltool.explain")}</span><kbd>E</kbd></button>
    <button type="button" onmousedown={keep} onclick={() => act("fix")}><Icon name="fix" size={15} /><span>{t("composer.seltool.fix")}</span><kbd>F</kbd></button>
    <span class="sep" aria-hidden="true"></span>
    <button type="button" class="ic" onmousedown={keep} onclick={() => act("prompt")} aria-label={t("composer.seltool.prompt")} title={t("composer.seltool.prompt")}><Icon name="term" size={15} /><kbd>P</kbd></button>
    <button type="button" class="ic" onmousedown={keep} onclick={() => act("permalink")} aria-label={t("composer.seltool.permalink")} title={t("composer.seltool.permalink")}
      ><svg class="i" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.6l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.3M9 11.4l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.7" /></svg><kbd>Y</kbd></button
    >
    {#if fixTokens !== null}<span class="sep" aria-hidden="true"></span><span class="est mono">{fmtTokens(fixTokens, { approx: true })}</span>{/if}
    {#if sel.clipped}<span class="clip">{t("composer.seltool.clipped")}</span>{/if}
  </div>
{/if}

<style>
  .seltool {
    position: fixed;
    z-index: var(--z-seltool);
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 0 5px;
    border-radius: var(--r-input);
    background: var(--toast-bg);
    color: var(--toast-fg);
    box-shadow: var(--shadow-pop);
    font-size: var(--fs-ui-s);
    white-space: nowrap;
    animation: seltool-in var(--dur-pop) var(--ease-out);
  }
  @keyframes seltool-in {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
  }
  .seltool button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border-radius: var(--r-btn);
    color: var(--toast-fg);
  }
  .seltool button.ic {
    padding: 0 7px;
  }
  .seltool button:hover,
  .seltool button:focus-visible {
    background: color-mix(in srgb, var(--toast-fg) 12%, transparent);
  }
  .seltool kbd {
    min-width: 16px;
    height: 17px;
    padding: 0 4px;
    border: 1px solid color-mix(in srgb, var(--toast-fg-2) 55%, transparent);
    border-radius: 4px;
    background: none;
    color: var(--toast-fg-2);
    font-size: var(--fs-meta);
    line-height: 15px;
    text-align: center;
  }
  .seltool :global(.i) {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: color-mix(in srgb, var(--toast-fg) 22%, transparent);
  }
  .est {
    padding: 0 6px;
    color: var(--toast-fg-2);
    font-size: var(--fs-meta);
  }
  .clip {
    padding: 0 8px;
    color: var(--toast-fg-2);
    font-size: var(--fs-label);
  }
  :global(::highlight(mitori-sel)) {
    background-color: var(--mark);
    color: inherit;
  }
</style>
