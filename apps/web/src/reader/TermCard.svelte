<!--
  Glossary term card (ux.md §4.3.7): 320 px, term · yomi / English · romaji / definition / uses + open in the
  glossary. Data comes with the section (`SectionView.terms`, CR ux-R16) — no extra fetch.
-->
<script lang="ts">
import type { GlossaryEntry } from "@mitori/core";
import { onMount } from "svelte";
import { t } from "../shell/index.ts";
import { followAnchor, naturalHeight, popoverPos } from "./popover.ts";
import { termLine } from "./term.ts";

let { entry, anchorEl, href, onenter, onleave }: { entry: GlossaryEntry; anchorEl: HTMLElement; href: string; onenter: () => void; onleave: () => void } =
  $props();
let el: HTMLDivElement | undefined = $state();
const line = $derived(termLine(entry));
let pos = $state<{ left: number; top: number; maxH: number | null }>({ left: 0, top: 0, maxH: null });

onMount(() =>
  followAnchor(() => {
    pos = popoverPos(anchorEl.getBoundingClientRect(), 320, naturalHeight(el, 160), window.innerWidth, window.innerHeight);
  }, el),
);
</script>

<div class="pop termcard" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px" style:max-height={pos.maxH === null ? undefined : `${pos.maxH}px`} style:overflow-y={pos.maxH === null ? undefined : "auto"} role="group" aria-label={entry.term} onpointerenter={onenter} onpointerleave={onleave} data-chrome>
  <p class="tt" data-user-content>{entry.term}</p>
  {#if line.yomi || line.en || line.where}
    <p class="ty" data-user-content>{[line.yomi, line.en].filter(Boolean).join(" · ")}{#if line.where}<span class="where mono">{line.yomi || line.en ? " · " : ""}{line.where}</span>{/if}</p>
  {/if}
  <p class="td" data-user-content>{entry.definition}</p>
  <p class="tf"><span>{t("term.uses", { n: entry.usedIn.length })}</span><a {href}>{t("term.open")}</a></p>
</div>

<style>
  .termcard {
    width: var(--termcard-w);
    padding: 14px 16px 12px;
  }
  .tt {
    font-size: var(--fs-body);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0;
  }
  .ty {
    font-size: var(--fs-label);
    color: var(--muted);
    margin: 1px 0 8px;
  }
  .tt + .td {
    margin-top: 8px;
  }
  .where {
    font-size: var(--fs-meta);
  }
  .td {
    font-size: var(--fs-ui);
    line-height: 1.7;
    color: var(--text);
    margin: 0 0 10px;
  }
  .tf {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-label);
    color: var(--muted);
    border-top: 1px solid var(--rule-soft);
    padding-top: 8px;
    margin: 0;
  }
  .tf a {
    color: var(--ink);
  }
</style>
