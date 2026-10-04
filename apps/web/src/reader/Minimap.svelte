<!--
  Rail minimap (ux.md §4.3.2-1): 200×120 thumbnail of the S1 layout (zones + rooms only); the current page's
  module room is tinted; click / Enter opens S1 with that room selected. Loaded after the section paints.
-->
<script lang="ts">
import { HREFS, type SectionId } from "@mitori/core";
import { t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";

let { page }: { page: SectionId | null } = $props();
const s = useStores();
const view = $derived(s.map.view);
const ws = $derived(s.workspace.key);

$effect(() => {
  if (!view && ws) {
    const h = setTimeout(() => void s.map.load(), 400);
    return () => clearTimeout(h);
  }
});

const mod = $derived(page ? s.doc.index?.nodes.get(page)?.module : undefined);
const node = $derived(mod && view ? view.diagram.nodes.find((n) => n.ref?.module === mod)?.id : undefined);
const box = $derived(view ? `0 0 ${view.layout.width} ${view.layout.height}` : "0 0 200 120");
</script>

{#if view && ws}
  <a class="mini" href={node ? HREFS.map(ws, node as `md_${string}`) : HREFS.map(ws)} aria-label={t("reader.minimap")} data-chrome>
    <svg viewBox={box} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {#each view.layout.groups as g (g.id)}<rect class="z" x={g.x} y={g.y} width={g.w} height={g.h} />{/each}
      {#each view.layout.nodes as n (n.id)}<rect class="r" class:cur={n.id === node} x={n.x} y={n.y} width={n.w} height={n.h} />{/each}
    </svg>
  </a>
{:else}
  <!-- the thumbnail's box is held while the map view loads (it is fetched after the section paints): the path card
       and the TOC below it never move (reader boot CLS, AC-U03) -->
  <div class="mini held" aria-hidden="true" data-chrome></div>
{/if}

<style>
  .mini {
    display: block;
    width: var(--minimap-w);
    height: var(--minimap-h);
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--paper);
    padding: 6px;
    flex: none;
  }
  .mini.held {
    border-style: dashed;
    border-color: var(--rule-soft);
  }
  a.mini:hover {
    border-color: var(--rule-2);
  }
  svg {
    width: 100%;
    height: 100%;
  }
  .z {
    fill: var(--zone-5);
    stroke: var(--rule-2);
    vector-effect: non-scaling-stroke;
  }
  .r {
    fill: var(--plan-floor);
    stroke: var(--plan-wall);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .r.cur {
    fill: var(--c-prop-bg);
    stroke: var(--c-prop);
  }
</style>
