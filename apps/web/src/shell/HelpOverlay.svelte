<!--
  Help (`?`, ux.md §4.11): first 「この画面でできること」 (NC-13) — the three steps of THIS screen (Reader: read →
  select and ask → check and accept; map; Review; Inbox), what a request costs and whether the AI engine can take one
  right now — then the effective keymap per scope in a modal <dialog>, a filter box (IME-safe: `input` only), the
  single-key toggle (WCAG 2.1.4). Closing returns focus (LayerStack).
-->
<script lang="ts">
import { engineProblem } from "../map/engine.ts";
import { useStores } from "../stores/app.svelte.ts";
import { guideOf } from "./help-guide.ts";
import { t } from "./index.ts";
import Rich from "./Rich.svelte";

const s = useStores();
let dlg: HTMLDialogElement | undefined = $state();
let q = $state("");
const SCOPES = ["global", "read", "map", "inbox", "review", "composer", "palette"] as const;

const guide = $derived(guideOf(s.router.route.name));
const engine = $derived(s.session.engine(s.workspace.status?.genEngine ?? null));
const engineLine = $derived.by(() => {
  if (s.session.engines === null) return t("help.engine.unknown");
  const p = engineProblem(engine);
  const name = engine?.engine ?? "claude-cli";
  if (p === "notInstalled") return t("help.engine.notInstalled", { engine: name });
  if (p === "notLoggedIn") return t("help.engine.notLoggedIn", { engine: name });
  if (p === "capabilityLost") return t("help.engine.capabilityLost", { engine: name });
  return t("help.engine.ok", { engine: name });
});
const engineOk = $derived(s.session.engines !== null && engineProblem(engine) === null);

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
  // register first: the layer remembers the focus to return to, and showModal() moves it into the dialog
  // closing the <dialog> first lifts the page's inertness, so the layer can return focus to where it was
  s.layers.open("dialog", "help", () => {
    dlg?.close();
    s.ui.helpOpen = false;
  });
  dlg.showModal();
  return () => s.layers.drop("help");
});

function close() {
  s.ui.helpOpen = false;
  s.layers.close("help");
}
</script>

<dialog class="dlg help" bind:this={dlg} aria-modal="true" aria-labelledby="help-t" oncancel={(e) => (e.preventDefault(), close())} data-chrome>
  <div class="hd">
    <h2 id="help-t">{t("help.guide.title")}</h2>
    <button type="button" class="icon-btn" aria-label={t("help.close")} onclick={close}>&times;</button>
  </div>
  <ol class="guide" aria-label={t("help.guide.title")}>
    {#each guide as step, i (step)}
      <li>
        <span class="num" aria-hidden="true">{i + 1}</span>
        <p class="gt">{t(`help.guide.${step}.t`)}</p>
        <p class="gd"><Rich text={t(`help.guide.${step}.d`)} /></p>
      </li>
    {/each}
  </ol>
  <p class="meta">
    <span class="eng" class:bad={!engineOk && s.session.engines !== null}><Rich text={engineLine} /></span>
    <span class="cost"><Rich text={t("help.cost")} /></span>
  </p>

  <h3 class="keys-t">{t("help.title")}</h3>
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
    width: 860px;
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .guide {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .guide li {
    position: relative;
    padding: 12px 14px 12px 44px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--paper);
  }
  .num {
    position: absolute;
    left: 14px;
    top: 9px;
    font-family: var(--font-serif);
    font-size: 1.375rem;
    line-height: 1;
    color: var(--muted);
    font-variant-numeric: oldstyle-nums;
  }
  .gt {
    margin: 0 0 4px;
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .gd {
    margin: 0;
    font-size: var(--fs-ui-s);
    line-height: 1.7;
    color: var(--text);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 12px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .eng::before {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--c-ok);
    vertical-align: 1px;
  }
  .eng.bad {
    color: var(--c-warn);
  }
  .eng.bad::before {
    background: var(--c-warn);
  }
  .keys-t {
    margin: 20px 0 8px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
    letter-spacing: 0;
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
    .cols,
    .guide {
      grid-template-columns: 1fr;
    }
  }
</style>
