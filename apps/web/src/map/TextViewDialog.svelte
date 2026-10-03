<!--
  「テキストで見る」 (ux.md §4.2.6, WCAG 1.1.1): the map as three tables in a modal dialog — zones → rooms →
  main files (LOC), connections, external actors. Keyboard-only open / close (AC-J16).
-->
<script lang="ts">
import { fmtInt } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import type { PlanModel } from "./render.ts";

let { model, onclose }: { model: PlanModel; onclose: () => void } = $props();
const s = useStores();
let dlg: HTMLDialogElement | undefined = $state();

$effect(() => {
  if (!dlg) return;
  dlg.showModal();
  s.layers.open("dialog", "text-view", onclose);
  return () => s.layers.drop("text-view");
});

const zones = $derived(
  [...new Set(model.rooms.filter((r) => !r.external).map((r) => r.zoneLabel))].map((z) => ({
    zone: z,
    rooms: model.rooms.filter((r) => !r.external && r.zoneLabel === z),
  })),
);
const pairs = $derived.by(() => {
  const m = new Map<string, number>();
  for (const e of model.edges) {
    const k = `${e.from}\u0000${e.to}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => {
    const [a, b] = k.split("\u0000");
    return { a: model.byId.get(a ?? "")?.label ?? a, b: model.byId.get(b ?? "")?.label ?? b, n };
  });
});
const actors = $derived(model.rooms.filter((r) => r.external));
</script>

<dialog class="dlg tv" bind:this={dlg} aria-modal="true" aria-labelledby="tv-t" oncancel={(e) => (e.preventDefault(), s.layers.close("text-view"))} data-chrome>
  <div class="hd">
    <h2 id="tv-t">{t("map.text.title")}</h2>
    <button type="button" class="icon-btn" aria-label={t("help.close")} onclick={() => s.layers.close("text-view")}>&times;</button>
  </div>
  <p id="tv-desc" class="desc">{t("map.text.summary", { zones: zones.length, rooms: model.rooms.length - actors.length, edges: model.edges.length })}</p>
  <table>
    <caption>{t("map.text.rooms")}</caption>
    <thead><tr><th scope="col">{t("map.text.zone")}</th><th scope="col">{t("map.text.room")}</th><th scope="col">{t("map.text.path")}</th><th scope="col">LOC</th></tr></thead>
    <tbody>
      {#each zones as z (z.zone)}
        {#each z.rooms as r, i (r.id)}
          <tr>{#if i === 0}<th scope="rowgroup" rowspan={z.rooms.length} data-user-content>{z.zone}</th>{/if}<td data-user-content>{r.label}</td><td class="mono" data-user-content>{r.path}</td><td class="mono num">{fmtInt(r.loc, s.prefs.lang)}</td></tr>
        {/each}
      {/each}
    </tbody>
  </table>
  {#if pairs.length}
    <table>
      <caption>{t("map.text.doors")}</caption>
      <tbody>
        {#each pairs as p, i (i)}<tr><td data-user-content>{t("map.text.door", { a: p.a ?? "", b: p.b ?? "", n: p.n })}</td></tr>{/each}
      </tbody>
    </table>
  {/if}
  {#if actors.length}
    <table>
      <caption>{t("map.text.actors")}</caption>
      <tbody>
        {#each actors as a (a.id)}<tr><td data-user-content>{a.label}</td><td data-user-content>{a.path}</td></tr>{/each}
      </tbody>
    </table>
  {/if}
</dialog>

<style>
  .tv {
    width: 760px;
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .desc {
    color: var(--muted);
    margin: 0 0 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 18px;
    font-size: var(--fs-ui);
  }
  caption {
    text-align: left;
    font-weight: var(--fw-strong);
    color: var(--ink);
    padding: 6px 0;
  }
  th,
  td {
    text-align: left;
    padding: 6px 8px 6px 0;
    border-bottom: 1px solid var(--rule-soft);
    vertical-align: top;
  }
  thead th {
    font-weight: var(--fw-regular);
    color: var(--muted);
    font-size: var(--fs-label);
  }
  .num {
    text-align: right;
  }
</style>
