<!--
  S8 生成と鮮度 (ux.md §4.8, P2): coverage, stale sections (from the outline), run history. Loaded as the `gen` chunk.
-->
<script lang="ts">
import type { GenRun } from "@mitori/core";
import { HREFS } from "@mitori/core";
import { onMount } from "svelte";
import { subtreeStats } from "../reader/outline.ts";
import { fmtDateTime, fmtInt, fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { useStores } from "../stores/app.svelte.ts";

const s = useStores();
const ws = $derived(s.workspace.key);
let runs = $state.raw<GenRun[]>([]);
const cov = $derived(s.doc.outline?.manifest.coverage ?? null);
const stale = $derived.by(() => {
  const ix = s.doc.index;
  if (!ix) return [];
  return ix.roots.map((id) => ({ id, n: subtreeStats(ix, id).stale, title: ix.nodes.get(id)?.title ?? id })).filter((x) => x.n > 0);
});

onMount(() => {
  const w = ws;
  if (w)
    void s.api
      .call("GET /ws/:ws/gen/runs", { params: { ws: w }, query: { limit: 20 } })
      .then((p) => (runs = p.items))
      .catch(() => {});
  markAfterPaint("mitori:section:rendered", { id: "gen" });
  s.router.painted();
});
</script>

<main id="main" class="genpage" tabindex="-1" data-chrome>
  <h1>{t("genPage.title")}</h1>
  {#if cov}
    <p class="cov">{t("genPage.coverage", { inc: fmtInt(cov.filesIncluded, s.prefs.lang), all: fmtInt(cov.filesTotal, s.prefs.lang) })}</p>
  {/if}
  <h2>{t("genPage.stale")}</h2>
  {#each stale as x (x.id)}
    <p class="row">{#if ws}<a href={HREFS.doc(ws, x.id)}>&sect;{s.doc.index?.numbers.get(x.id)} <span data-user-content>{x.title}</span></a>{/if} <span>{t("genPage.staleN", { n: x.n })}</span></p>
  {:else}
    <p class="note">{t("genPage.noStale")}</p>
  {/each}
  <h2>{t("genPage.runs")}</h2>
  {#each runs as r (r.id)}
    <p class="row mono">
      <span>{r.startedAt ? fmtDateTime(r.startedAt, s.prefs.lang) : "–"}</span><span>{t(`gen.effort.${r.effort}`)}</span><span>{r.engine}</span><span
        >{fmtTokensImpl(r.usage.in + r.usage.cacheRead + r.usage.cacheWrite)} / {fmtTokensImpl(r.usage.out)}</span
      ><span>{fmtUsdImpl(r.usage.apiUsd, "gen")}</span>
    </p>
  {:else}
    <p class="note">{t("genPage.noRuns")}</p>
  {/each}
</main>

<style>
  .genpage {
    max-width: 860px;
    margin: 0 auto;
    padding: 48px 24px 120px;
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--fs-h1);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 12px;
  }
  h2 {
    font-size: var(--fs-h3);
    color: var(--ink);
    margin: 28px 0 8px;
  }
  .row {
    display: flex;
    gap: 14px;
    padding: 8px 0;
    border-bottom: 1px solid var(--rule-soft);
    margin: 0;
    font-size: var(--fs-ui);
  }
  .note,
  .cov {
    color: var(--muted);
  }
</style>
