<!--
  Room card (S1 right column top when a room is selected; ux.md §4.2.2, contract `RoomCardProps`).
-->
<script lang="ts">
import type { SectionId } from "@mitori/core";
import { fmtTokensImpl } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";

let {
  title,
  summary,
  freshness,
  threads,
  section,
  sectionLabel,
  genTokens,
  flows = [],
  changeHref = null,
  onflow,
  onread,
  ongenerate,
}: {
  title: string;
  summary: string;
  freshness: "fresh" | "stale" | "unknown";
  threads: number;
  section: SectionId | null;
  sectionLabel: string;
  genTokens: number | null;
  /** §3 flows through this room (`§3.1 ⑤⑥`); a click overlays that flow on the map. */
  flows?: { section: SectionId; num: string; steps: number[]; on: boolean }[];
  /** The module page's 「変更の手引き」 (what a change here reaches, its tests, its entries), when it has one. */
  changeHref?: string | null;
  onflow?: (section: SectionId) => void;
  onread: () => void;
  ongenerate: () => void;
} = $props();

/** ① … ⑳ (U+2460 + n − 1), plain digits beyond. */
const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n));

// every new room shown in the card (mount or swap) is one `mitori:room:card`
$effect(() => {
  void title;
  markAfterPaint("mitori:room:card");
});
</script>

<section class="room-card card" aria-labelledby="room-t" data-chrome>
  <h2 id="room-t" data-user-content>{title}</h2>
  <p class="sum" data-user-content>{summary}</p>
  <p class="meta">
    {#if freshness === "stale"}<span class="stale">&#x26A0;&#xFE0E; {t("map.room.stale")}</span>{:else if freshness === "fresh"}<span class="ok">{t("map.room.fresh")}</span>{/if}
    {#if threads > 0}<span>{t("map.room.threads", { n: threads })}</span>{/if}
  </p>
  {#if flows.length}
    <p class="flows">
      <span class="lab">{t("map.room.flows")}</span>
      {#each flows as f (f.section)}
        <button type="button" class="flow" aria-pressed={f.on} onclick={() => onflow?.(f.section)}>&sect;{f.num} {f.steps.map(circled).join("")}</button>
      {/each}
    </p>
  {/if}
  <div class="acts">
    {#if section}<button type="button" class="btn btn-pri btn-s" onclick={onread}>{t("map.room.read", { section: sectionLabel })}</button>{/if}
    {#if changeHref}<a class="btn btn-sec btn-s" href={changeHref}>{t("map.room.change")}</a>{/if}
    {#if genTokens !== null}<button type="button" class="btn btn-sec btn-s" onclick={ongenerate}>{t("map.room.generate", { k: fmtTokensImpl(genTokens, { approx: true }) })}</button>{/if}
  </div>
</section>

<style>
  .flows {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 0 0 12px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .flow {
    min-height: 24px;
    padding: 0 8px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-chip);
    background: var(--sheet);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .flow[aria-pressed="true"] {
    background: var(--flow-tag-bg);
    border-color: var(--flow-tag-bg);
    color: var(--flow-tag-fg);
  }
  .room-card {
    padding: 16px 18px;
    box-shadow: var(--shadow-soft);
  }
  h2 {
    font-family: var(--font-serif);
    font-size: var(--fs-lead);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 6px;
  }
  .sum {
    margin: 0 0 8px;
    font-size: var(--fs-ui);
    color: var(--text);
    line-height: 1.7;
  }
  .meta {
    display: flex;
    gap: 10px;
    font-size: var(--fs-label);
    color: var(--muted);
    margin: 0 0 10px;
  }
  .stale {
    color: var(--c-warn);
  }
  .ok {
    color: var(--c-ok);
  }
  .acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
