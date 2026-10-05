<!--
  The ONE shared block gutter (ux.md Δ10, AC-U32): moves to the hovered / focused block's left gutter; three
  28×28 buttons (comment C / explain E / fix F) and, at 詳しい, the block history (EX-10). Hides 160 ms after the
  pointer leaves the block unless it is on the gutter itself.
-->
<script lang="ts">
import type { BlockId } from "@mitori/core";
import Icon from "../shell/Icon.svelte";
import { t } from "../shell/index.ts";

let {
  block,
  top,
  left,
  onaction,
  onenter,
  onleave,
  canTranslate = false,
}: {
  block: BlockId | null;
  top: number;
  left: number;
  onaction: (a: "comment" | "explain" | "fix" | "history" | "simplify" | "translate", el?: HTMLElement) => void;
  canTranslate?: boolean;
  onenter: () => void;
  onleave: () => void;
} = $props();
</script>

<div class="gutter" class:on={block !== null} style:transform="translate({left}px, {top}px)" role="group" aria-label={t("reader.gutter")} onpointerenter={onenter} onpointerleave={onleave} data-chrome>
  <button type="button" aria-label={t("reader.act.comment")} title={t("reader.act.comment")} tabindex={block ? 0 : -1} onclick={() => onaction("comment")}><Icon name="comment" /></button>
  <button type="button" aria-label={t("reader.act.explain")} title={t("reader.act.explain")} tabindex={block ? 0 : -1} onclick={() => onaction("explain")}><Icon name="explain" /></button>
  <button type="button" aria-label={t("reader.act.fix")} title={t("reader.act.fix")} tabindex={block ? 0 : -1} onclick={() => onaction("fix")}><Icon name="fix" /></button>
  <button type="button" class="hist" aria-label={t("reader.act.history")} title={t("reader.act.history")} tabindex={block ? 0 : -1} onclick={(e) => onaction("history", e.currentTarget)}><Icon name="clock" /></button>
  <button type="button" aria-label={t("reader.act.simplify")} title={t("reader.act.simplify")} tabindex={block ? 0 : -1} onclick={() => onaction("simplify")}><Icon name="minus" /></button>
  {#if canTranslate}<button type="button" aria-label={t("reader.act.translate")} title={t("reader.act.translate")} tabindex={block ? 0 : -1} onclick={() => onaction("translate")}><Icon name="refresh" /></button>{/if}
</div>

<style>
  .gutter {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--blk-btn);
    display: flex;
    flex-direction: column;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-hover-l);
    z-index: var(--z-local);
  }
  .gutter.on {
    opacity: 1;
    pointer-events: auto;
  }
  button {
    width: var(--blk-btn);
    height: var(--blk-btn);
    display: grid;
    place-items: center;
    border-radius: var(--r-btn);
    color: var(--muted);
  }
  /* the history is the expert's tool (詳しい) */
  .hist {
    display: none;
  }
  :global(html[data-level="expert"]) .hist {
    display: grid;
  }
  button:hover,
  button:focus-visible {
    background: var(--hover);
    color: var(--ink);
  }
</style>
