<!--
  Root of the export viewer (ux.md §4.13, AppMode "viewer"): header · read-only band · rail │ Reader │ about column,
  or the map; ⌘K and the help overlay on top. The same components and styles as the app's S2 / S1, no API, no SSE.
-->
<script lang="ts">
import { onMount } from "svelte";
import { isComposingImpl } from "../shell/ime.ts";
import { t } from "../shell/index.ts";
import { computeLayout } from "../shell/width.ts";
import { typingTarget } from "./keys.ts";
import { provideViewer, type ViewerState } from "./state.svelte.ts";
import ViewerHeader from "./ViewerHeader.svelte";
import ViewerHelp from "./ViewerHelp.svelte";
import ViewerMap from "./ViewerMap.svelte";
import ViewerPalette from "./ViewerPalette.svelte";
import ViewerRail from "./ViewerRail.svelte";
import ViewerReader from "./ViewerReader.svelte";

let { v }: { v: ViewerState } = $props();
// svelte-ignore state_referenced_locally
provideViewer(v);

const layout = $derived(computeLayout(v.width, "doc", "margin", 0, false));
const map = $derived(v.route.name === "map");
const meta = $derived(v.payload.meta);
const exported = $derived(
  new Date(meta.exportedAt).toLocaleString(v.lang === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
);
const withCode = $derived(Object.keys(v.payload.cites).length);
// `.` / ⌘K 「出典をすべて表示」: levels.css shows every cite chip while `html.show-cites` is set (newcomer's paragraph-end form)
$effect(() => {
  document.documentElement.classList.toggle("show-cites", v.showCites);
});

onMount(() => {
  const sync = () => v.sync();
  window.addEventListener("hashchange", sync);
  // width of the grid container (never 100vw: a scrollbar is accounted for) — the header and `.body` span the page
  const size = () => (v.width = document.documentElement.clientWidth);
  size();
  window.addEventListener("resize", size, { passive: true });
  const key = (e: KeyboardEvent) => {
    if (isComposingImpl(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      v.paletteOpen = !v.paletteOpen;
      return;
    }
    if (typingTarget(e.target) || mod || e.altKey) {
      if (e.key === "Escape" && v.railOpen) v.railOpen = false;
      return;
    }
    if (e.key === "/" && !v.paletteOpen) {
      e.preventDefault();
      v.paletteOpen = true;
    } else if (e.key === "?" && !v.helpOpen) {
      e.preventDefault();
      v.helpOpen = true;
    } else if (e.key === "Escape" && v.railOpen) v.railOpen = false;
  };
  window.addEventListener("keydown", key);
  return () => {
    window.removeEventListener("hashchange", sync);
    window.removeEventListener("keydown", key);
    window.removeEventListener("resize", size);
  };
});

function skip(e: Event) {
  e.preventDefault();
  document.getElementById("main")?.focus();
}
</script>

<div class="app viewer" data-mode="viewer">
  <a class="skip" href="#main" onclick={skip}>{t("a11y.skip")}</a>
  <ViewerHeader />
  <div class="vband" role="status">
    <b>{t("export.band.readonly")}</b>
    <span class="sep" aria-hidden="true">&middot;</span><span>{exported}</span>
    {#if meta.head}<span class="sep" aria-hidden="true">&middot;</span><span class="mono">{t("export.band.head", { head: meta.head.slice(0, 7) })}</span>{/if}
    <span class="sep" aria-hidden="true">&middot;</span><span data-redactions={meta.redactions}>{t("export.band.redactions", { n: meta.redactions })}</span>
    <span class="sep" aria-hidden="true">&middot;</span><span>{withCode > 0 ? t("export.band.code", { n: withCode }) : t("export.band.noCode")}</span>
  </div>
  {#if map}
    <div class="body map-body" style:grid-template-columns="minmax(0,1fr)">
      <ViewerMap />
    </div>
  {:else}
    <div class="body reader-body" style:grid-template-columns="{layout.rail}px minmax(0,1fr) {v.width >= 1024 ? layout.ctx : 0}px">
      <ViewerRail mode={layout.railMode} />
      <ViewerReader />
    </div>
    {#if v.railOpen && layout.railMode === "drawer"}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="scrim drawer-scrim" onclick={() => (v.railOpen = false)}></div>
    {/if}
  {/if}
  {#if v.paletteOpen}<ViewerPalette />{/if}
  {#if v.helpOpen}<ViewerHelp />{/if}
  <div class="sr-only" aria-live="polite">{v.polite}</div>
</div>

<style>
  .reader-body {
    align-items: start;
  }
</style>
