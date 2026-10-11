<script lang="ts">
import type { UsageTotals } from "@mitori/core";
import { generatedTokens } from "../map/hero.ts";
import { fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";

let { totals, stale, fiveName, onread }: { totals: UsageTotals; stale: number; fiveName: string; onread?: (() => void) | undefined } = $props();
</script>

<section class="done card" aria-labelledby="done-t" data-chrome>
  <h2 id="done-t">{t("gen.card.doneTitle")}</h2>
  <div class="done-main">
    <p>
      <b>{t("map.generated", generatedTokens(totals, fmtTokensImpl, (u) => fmtUsdImpl(u, "gen")))}</b>
      {#if stale > 0}<span class="stale">{t("map.staleChapters", { n: stale })}</span>{/if}
    </p>
    {#if onread}<button type="button" class="btn btn-pri" onclick={onread}>{t("map.read5", { name: fiveName })}</button>{/if}
  </div>
</section>

<style>
  .done { padding: 18px 20px 16px; box-shadow: var(--shadow-soft); }
  .done h2 { font-family: var(--font-serif); font-size: var(--fs-lead); font-weight: var(--fw-strong); color: var(--ink); margin: 0 0 12px; }
  .done-main { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: var(--fs-ui); }
  .done-main p { margin: 0; display: flex; flex-direction: column; }
  .stale { color: var(--c-warn); font-size: var(--fs-label); }
</style>
