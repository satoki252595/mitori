<!--
  Cite peek for a range the export did not embed (excerpts off, file unreadable, over the cap): the same box as the
  app's peek, header only, with the reason in plain words (ux.md §4.13: 「この書き出しには含まれていません」).
-->
<script lang="ts">
import { onMount } from "svelte";
import { followAnchor, popoverPos } from "../reader/popover.ts";
import { t } from "../shell/index.ts";
import { useViewer } from "./state.svelte.ts";

let { cite, anchorEl, onenter, onleave }: { cite: string; anchorEl: HTMLElement; onenter: () => void; onleave: () => void } = $props();
const v = useViewer();
let el: HTMLDivElement | undefined = $state();
let pos = $state<{ left: number; top: number; maxH: number | null }>({ left: 0, top: 0, maxH: null });
const withCode = $derived(Object.keys(v.payload.cites).length > 0);

onMount(() =>
  followAnchor(() => {
    pos = popoverPos(anchorEl.getBoundingClientRect(), Math.min(420, window.innerWidth - 32), el?.scrollHeight ?? 110, window.innerWidth, window.innerHeight);
  }, el),
);
</script>

<div class="pop omitted" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px" role="group" aria-label={cite} onpointerenter={onenter} onpointerleave={onleave} data-chrome>
  <p class="p mono" data-user-content>{cite.replace(/-(\d+)$/, "–$1")}</p>
  <p class="n">{t("export.cite.omitted")}</p>
  <p class="m">{withCode ? t("export.cite.unreadable") : t("export.cite.noCode")}</p>
</div>

<style>
  .omitted {
    width: min(420px, calc(100% - 32px));
    padding: 12px 14px;
  }
  .omitted p {
    margin: 0;
  }
  .p {
    font-size: var(--fs-label);
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .n {
    margin-top: 6px;
    font-size: var(--fs-ui);
    color: var(--text);
  }
  .m {
    margin-top: 2px;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
</style>
