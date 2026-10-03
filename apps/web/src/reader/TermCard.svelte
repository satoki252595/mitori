<!--
  Glossary term card (ux.md §4.3.7): 320 px, term · yomi / English · romaji / definition / uses + open in the
  glossary. Data comes with the section (`SectionView.terms`, CR ux-R16) — no extra fetch.
-->
<script lang="ts">
import type { GlossaryEntry } from "@mitori/core";
import { onMount } from "svelte";
import { t } from "../shell/index.ts";

let { entry, anchorEl, href, onenter, onleave }: { entry: GlossaryEntry; anchorEl: HTMLElement; href: string; onenter: () => void; onleave: () => void } =
  $props();
let el: HTMLDivElement | undefined = $state();
let pos = $state({ left: 0, top: 0 });

onMount(() => {
  const a = anchorEl.getBoundingClientRect();
  const h = el?.offsetHeight ?? 160;
  const below = a.bottom + 6 + h <= window.innerHeight - 30;
  pos = { left: Math.max(16, Math.min(a.left, window.innerWidth - 336)), top: below ? a.bottom + 6 : a.top - 6 - h };
});
</script>

<div class="pop termcard" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px" role="group" aria-label={entry.term} onpointerenter={onenter} onpointerleave={onleave} data-chrome>
  <p class="tt" data-user-content>{entry.term}</p>
  <p class="ty" data-user-content>{[entry.yomi, entry.en, entry.romaji].filter(Boolean).join(" · ")}</p>
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
