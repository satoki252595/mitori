<!--
  How to use this file: the few keys and gestures of the read-only viewer (the app's full help lists its own scopes).
-->
<script lang="ts">
import { onMount } from "svelte";
import { t } from "../shell/index.ts";
import { isMacPlatform } from "./keys.ts";
import { useViewer } from "./state.svelte.ts";

const v = useViewer();
let panel: HTMLDivElement | undefined = $state();
let opener: HTMLElement | null = null;
const mac = typeof navigator !== "undefined" && isMacPlatform(navigator);
const rows: [string[], string][] = [
  [[mac ? "⌘K" : "Ctrl K", "/"], t("export.help.search")],
  [["j", "k"], t("export.help.blocks")],
  [["-", "=", "0"], t("export.help.level")],
  [["1–9"], t("export.help.chapters")],
  [["."], t("export.help.cites")],
  [["y"], t("export.help.permalink")],
  [["?"], t("export.help.this")],
];

function close() {
  v.helpOpen = false;
}
onMount(() => {
  opener = document.activeElement as HTMLElement | null;
  panel?.focus();
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", esc);
  return () => {
    window.removeEventListener("keydown", esc);
    if (opener && document.contains(opener)) opener.focus();
  };
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim help-scrim" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="help" role="dialog" aria-modal="true" aria-labelledby="help-t" tabindex="-1" bind:this={panel}>
    <h2 id="help-t">{t("export.help.title")}</h2>
    <p class="lead">{t("export.help.lead")}</p>
    <dl>
      {#each rows as [keys, label] (label)}
        <div><dt>{#each keys as k, i (k)}{#if i > 0}<span class="or"> </span>{/if}<kbd>{k}</kbd>{/each}</dt><dd>{label}</dd></div>
      {/each}
    </dl>
    <button type="button" class="btn btn-sec" onclick={close}>{t("help.close")}</button>
  </div>
</div>

<style>
  .help-scrim {
    display: grid;
    place-items: start center;
    padding-top: 12vh;
    z-index: var(--z-palette);
  }
  .help {
    width: min(480px, calc(100% - 32px));
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-dialog);
    box-shadow: var(--shadow-pop);
    padding: 22px 26px;
    outline: none;
  }
  h2 {
    font-family: var(--font-serif);
    font-size: var(--fs-title);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 6px;
  }
  .lead {
    margin: 0 0 14px;
    color: var(--muted);
    font-size: var(--fs-label);
    line-height: 1.7;
  }
  dl {
    margin: 0 0 16px;
    display: grid;
    gap: 6px;
  }
  dl div {
    display: grid;
    grid-template-columns: 9em 1fr;
    gap: 12px;
    align-items: baseline;
  }
  dt {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  dd {
    margin: 0;
    font-size: var(--fs-ui);
    color: var(--text);
  }
  .or {
    width: 2px;
  }
</style>
