<!--
  Check-a-claim popover (ux.md §4.3.5): 「推測 — …」 + three choices. 「確認済にする」 is optimistic
  (`POST /verify`, rolled back on failure, ✓✓ within 100 ms — AC-U34); for newcomer / standard it is enabled
  only after the claim's cite peek was opened (UXP-31). The other two hand off to the Composer (WP-10b) through
  the `mitori:compose` window event.
-->
<script lang="ts">
import { onMount } from "svelte";
import { t } from "../shell/index.ts";

let {
  verdict,
  anchorEl,
  canVerify,
  onverify,
  onask,
  onexpert,
  onclose,
}: { verdict: string; anchorEl: HTMLElement; canVerify: boolean; onverify: () => void; onask: () => void; onexpert: () => void; onclose: () => void } =
  $props();
let el: HTMLDivElement | undefined = $state();
let pos = $state({ left: 0, top: 0 });

onMount(() => {
  const a = anchorEl.getBoundingClientRect();
  const h = el?.offsetHeight ?? 160;
  pos = { left: Math.max(16, Math.min(a.left, window.innerWidth - 356)), top: a.bottom + 6 + h <= window.innerHeight - 30 ? a.bottom + 6 : a.top - 6 - h };
  (el?.querySelector("button:not([aria-disabled='true'])") as HTMLElement | null)?.focus();
});
</script>

<div class="pop claim" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px" role="dialog" aria-labelledby="claim-t" data-chrome>
  <p id="claim-t" class="h">{t(`claim.title.${verdict === "unsupported" ? "unsupported" : verdict === "stale" ? "stale" : "inferred"}`)}</p>
  <button type="button" class="opt" aria-disabled={!canVerify} title={canVerify ? undefined : t("claim.verifyNeedsPeek")} onclick={() => canVerify && onverify()}>
    <b>{t("claim.verify")}</b><span>{canVerify ? t("claim.verifyHint") : t("claim.verifyNeedsPeek")}</span>
  </button>
  <button type="button" class="opt" onclick={onask}><b>{t("claim.ask")}</b><span>{t("claim.askHint")}</span></button>
  <button type="button" class="opt" onclick={onexpert}><b>{t("claim.expert")}</b><span>{t("claim.expertHint")}</span></button>
  <button type="button" class="x" aria-label={t("help.close")} onclick={onclose}>&times;</button>
</div>

<style>
  .claim {
    width: 340px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .h {
    margin: 0 24px 4px 2px;
    font-size: var(--fs-ui);
    color: var(--c-guess);
    font-weight: var(--fw-strong);
  }
  .opt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 1px;
    padding: 8px 10px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
  }
  .opt:hover {
    border-color: var(--rule-2);
    background: var(--paper);
  }
  .opt[aria-disabled="true"] {
    cursor: not-allowed;
  }
  .opt[aria-disabled="true"] b {
    color: var(--muted);
  }
  .opt b {
    font-size: var(--fs-ui);
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .opt span {
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .x {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    color: var(--muted);
  }
</style>
