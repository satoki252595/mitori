<!--
  Room card (S1 right column top when a room is selected; ux.md §4.2.2, contract `RoomCardProps`): the shared
  chrome (title · summary · freshness · threads · read). The app-only extras arrive as snippets from web-only
  markup — the §3 flow buttons (`top`, above the actions) and the change-guide / generate buttons (`actions`,
  after the read button) — so the export viewer, which shows neither, does not bundle them (EXP-I-05).
-->
<script lang="ts">
import type { SectionId } from "@mitori/core";
import type { Snippet } from "svelte";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";

let {
  title,
  summary,
  freshness,
  threads,
  section,
  sectionLabel,
  onread,
  top,
  actions,
}: {
  title: string;
  summary: string;
  freshness: "fresh" | "stale" | "unknown";
  threads: number;
  /** Section to read. */
  section: SectionId | null;
  sectionLabel: string;
  onread: () => void;
  /** §3 flows through this room (app only; the export viewer omits it). */
  top?: Snippet;
  /** Change-guide and generate buttons after the read button (app only; the export viewer omits them). */
  actions?: Snippet;
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
  {@render top?.()}
  <div class="acts">
    {#if section}<button type="button" class="btn btn-pri btn-s" onclick={onread}>{t("map.room.read", { section: sectionLabel })}</button>{/if}
    {@render actions?.()}
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
