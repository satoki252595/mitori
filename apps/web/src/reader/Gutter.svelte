<!--
  The ONE shared block gutter (ux.md Δ10, AC-U32): moves to the hovered / focused block's left gutter; three
  28×28 buttons (comment C / explain E / fix F). Hides 160 ms after the pointer leaves the block unless it is
  on the gutter itself.
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
}: { block: BlockId | null; top: number; left: number; onaction: (a: "comment" | "explain" | "fix") => void; onenter: () => void; onleave: () => void } =
  $props();
</script>

<div class="gutter" class:on={block !== null} style:transform="translate({left}px, {top}px)" role="group" aria-label={t("reader.gutter")} onpointerenter={onenter} onpointerleave={onleave} data-chrome>
  <button type="button" aria-label={t("reader.act.comment")} title={t("reader.act.comment")} tabindex={block ? 0 : -1} onclick={() => onaction("comment")}><Icon name="comment" /></button>
  <button type="button" aria-label={t("reader.act.explain")} title={t("reader.act.explain")} tabindex={block ? 0 : -1} onclick={() => onaction("explain")}><Icon name="explain" /></button>
  <button type="button" aria-label={t("reader.act.fix")} title={t("reader.act.fix")} tabindex={block ? 0 : -1} onclick={() => onaction("fix")}><Icon name="fix" /></button>
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
  button:hover,
  button:focus-visible {
    background: var(--hover);
    color: var(--ink);
  }
</style>
