<!--
  What a 推測 / 裏付けなし / 古い可能性 badge means, in the read-only export (the app's claim popover offers
  確認 / 質問 / 専門家へ; a file can do none of them, so it only explains).
-->
<script lang="ts">
import { onMount } from "svelte";
import { followAnchor, popoverPos } from "../reader/popover.ts";
import { t } from "../shell/index.ts";

let { verdict, anchorEl, onclose }: { verdict: string; anchorEl: HTMLElement; onclose: () => void } = $props();
let el: HTMLDivElement | undefined = $state();
let pos = $state<{ left: number; top: number; maxH: number | null }>({ left: 0, top: 0, maxH: null });
const kind = $derived(verdict === "unsupported" ? "unsupported" : verdict === "stale" ? "stale" : "inferred");

onMount(() =>
  followAnchor(() => (pos = popoverPos(anchorEl.getBoundingClientRect(), 340, el?.scrollHeight ?? 120, window.innerWidth, window.innerHeight)), el),
);
</script>

<div class="pop note" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px" role="dialog" aria-labelledby="note-t" data-chrome>
  <p id="note-t" class="h">{t(`claim.title.${kind}`)}</p>
  <p class="b">{t("export.verdict.note")}</p>
  <button type="button" class="x" aria-label={t("help.close")} onclick={onclose}>&times;</button>
</div>

<style>
  .note {
    width: 340px;
    max-width: calc(100% - 32px);
    padding: 12px 14px;
  }
  .h {
    margin: 0 24px 4px 0;
    font-size: var(--fs-ui);
    color: var(--c-guess);
    font-weight: var(--fw-strong);
  }
  .b {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.7;
  }
  .x {
    position: absolute;
    right: 6px;
    top: 6px;
    width: 24px;
    height: 24px;
    border-radius: var(--r-btn);
    color: var(--muted);
  }
  .x:hover {
    background: var(--hover);
  }
</style>
