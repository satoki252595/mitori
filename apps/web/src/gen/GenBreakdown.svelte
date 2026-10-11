<!-- Optional details: SSR supplies this synchronously; enhanced cards load it when opened. -->
<script lang="ts">
import type { EngineId, GenEstimate } from "@mitori/core";
import { fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { estimateValidity, stageRows } from "./estimate.ts";

let { est, engine, onengine }: { est: GenEstimate; engine: EngineId; onengine: (e: EngineId) => void } = $props();
const validity = $derived(estimateValidity(est, Date.now()));
</script>

<table>
  <thead><tr><th scope="col">{t("gen.card.colStage")}</th><th scope="col" class="num">{t("gen.card.colIo")}</th><th scope="col" class="num">$</th><th scope="col" class="num">{t("gen.card.colTime")}</th></tr></thead>
  <tbody>
    {#each stageRows(est) as r (r.stage)}
      <tr><td>{t(`gen.stage.${r.stage}`)}{#if r.critical}*{/if} &middot; {r.tasks}</td><td class="mono num">{r.io}</td><td class="mono num">{r.usd}</td><td class="mono num">{r.time}</td></tr>
    {/each}
  </tbody>
</table>
<p class="note">{t("gen.card.critical")}</p>
<fieldset class="eng">
  <legend>{t("gen.card.engineLabel")}</legend>
  {#each est.alternatives as alt (alt.engine)}
    <label
      ><input type="radio" name="mitori-engine" value={alt.engine} checked={alt.engine === engine} onchange={() => onengine(alt.engine)} />
      <span class="mono">{alt.engine}</span>
      <span>{t("gen.card.alt", { c: alt.concurrency, usd: fmtUsdImpl(alt.apiUsd, "gen") })}{#if alt.sessionTokens}{t("gen.card.altSession", { k: fmtTokensImpl(alt.sessionTokens) })}{/if}{#if alt.uncalibrated}{t("gen.card.uncalibrated")}{/if}</span>
    </label>
  {/each}
</fieldset>
{#if validity}<p class="note mono">{t("gen.card.validity", { id: est.id.slice(3, 11), min: validity.minutes })}</p>{/if}

<style>
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  th { text-align: left; font-weight: var(--fw-regular); color: var(--muted); border-bottom: 1px solid var(--rule); padding: 4px 4px 4px 0; white-space: nowrap; }
  td { padding: 4px 4px 4px 0; border-bottom: 1px solid var(--rule-soft); }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .note { color: var(--muted); margin: 4px 0; }
  .eng { border: 0; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .eng legend { color: var(--muted); padding: 0; margin-bottom: 4px; }
  .eng label { display: flex; gap: 8px; align-items: center; min-height: 24px; }
</style>
