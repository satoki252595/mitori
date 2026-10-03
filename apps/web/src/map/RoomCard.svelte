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
  onread: () => void;
  ongenerate: () => void;
} = $props();

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
  <div class="acts">
    {#if section}<button type="button" class="btn btn-pri btn-s" onclick={onread}>{t("map.room.read", { section: sectionLabel })}</button>{/if}
    {#if genTokens !== null}<button type="button" class="btn btn-sec btn-s" onclick={ongenerate}>{t("map.room.generate", { k: fmtTokensImpl(genTokens, { approx: true }) })}</button>{/if}
  </div>
</section>

<style>
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
