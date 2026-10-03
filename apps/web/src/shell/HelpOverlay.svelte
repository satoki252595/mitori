<!--
  Help (`?`, ux.md §4.11): the effective keymap per scope in a modal <dialog>, a filter box (IME-safe: `input`
  only), the single-key toggle (WCAG 2.1.4). Closing returns focus (LayerStack).
-->
<script lang="ts">
import { useStores } from "../stores/app.svelte.ts";
import { t } from "./index.ts";

const s = useStores();
let dlg: HTMLDialogElement | undefined = $state();
let q = $state("");
const SCOPES = ["global", "read", "map", "inbox", "review", "composer", "palette"] as const;

const groups = $derived.by(() => {
  const needle = q.trim().toLowerCase();
  return SCOPES.map((scope) => ({
    scope,
    rows: s.keys
      .defs()
      .filter((d) => d.scope === scope)
      .map((d) => ({ id: d.id, label: t(`shortcut.${d.id}`), keys: d.keys.map((k) => s.keys.label(k)), single: d.singleKey }))
      .filter((r) => !needle || r.label.toLowerCase().includes(needle) || r.keys.join(" ").toLowerCase().includes(needle)),
  })).filter((g) => g.rows.length > 0);
});

$effect(() => {
  if (!dlg) return;
  dlg.showModal();
  s.layers.open("dialog", "help", () => (s.ui.helpOpen = false));
  return () => s.layers.drop("help");
});

function close() {
  s.ui.helpOpen = false;
  s.layers.close("help");
}
</script>

<dialog class="dlg help" bind:this={dlg} aria-modal="true" aria-labelledby="help-t" oncancel={(e) => (e.preventDefault(), close())} data-chrome>
  <div class="hd">
    <h2 id="help-t">{t("help.title")}</h2>
    <button type="button" class="icon-btn" aria-label={t("help.close")} onclick={close}>&times;</button>
  </div>
  <input class="flt" type="search" placeholder={t("help.filter")} aria-label={t("help.filter")} bind:value={q} />
  <div class="cols">
    {#each groups as g (g.scope)}
      <section>
        <h3>{t(`help.scope.${g.scope}`)}</h3>
        {#each g.rows as r (r.id)}
          <div class="r" class:off={r.single && !s.prefs.singleKeys}>
            <span>{r.label}</span>
            <span class="k">{#each r.keys.slice(0, 2) as k (k)}<kbd>{k}</kbd>{/each}</span>
          </div>
        {/each}
      </section>
    {/each}
  </div>
  <div class="ft">
    <span>{t(s.prefs.singleKeys ? "help.singleOn" : "help.singleOff")}</span>
    <button type="button" class="btn btn-sec btn-s" onclick={() => s.prefs.setSingleKeys(!s.prefs.singleKeys)}>{t("help.toggleSingle")}</button>
  </div>
</dialog>

<style>
  .help {
    width: 820px;
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .flt {
    width: 100%;
    height: 34px;
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    padding: 0 10px;
    margin: 0 0 12px;
    background: var(--sheet);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 28px;
  }
  h3 {
    font-size: var(--fs-meta);
    letter-spacing: 0.1em;
    color: var(--faint);
    margin: 10px 0 4px;
  }
  .r {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-ui-s);
    padding: 4px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .r.off span:first-child {
    text-decoration: line-through;
    color: var(--muted);
  }
  .k {
    display: flex;
    gap: 3px;
  }
  .ft {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
    font-size: var(--fs-ui);
    color: var(--muted);
  }
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
