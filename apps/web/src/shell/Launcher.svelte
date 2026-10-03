<!--
  S0 Launcher (ux.md §4.1): open a path or GitHub URL, recent workspaces (last opened first). Errors go under the
  input with role="alert". Cards use roving focus via native links (↑↓ handled by the browser's Tab order).
-->
<script lang="ts">
import { HREFS, MitoriError, type WorkspaceSummary } from "@mitori/core";
import { useStores } from "../stores/app.svelte.ts";
import { fmtRelative } from "./fmt.ts";
import { errorText, t } from "./index.ts";
import { markAfterPaint } from "./perf.ts";
import Rich from "./Rich.svelte";

const s = useStores();
let target = $state("");
let busy = $state(false);
let error = $state<string | null>(null);
const list = $derived(s.session.workspaces);

$effect(() => {
  void s.session.loadWorkspaces().finally(() => {
    markAfterPaint("mitori:section:rendered", { id: "launcher" });
    s.router.painted();
  });
});

async function open(e: SubmitEvent) {
  e.preventDefault();
  const v = target.trim();
  if (!v) {
    error = t("error.E_INVALID_INPUT");
    return;
  }
  busy = true;
  error = null;
  try {
    const ws = await s.api.call("POST /workspaces", { params: {}, body: { target: v } });
    s.session.upsertWorkspace(ws);
    await s.router.go({ name: "map", ws: ws.info.key });
  } catch (err) {
    error = errorText(MitoriError.from(err).toData());
  } finally {
    busy = false;
  }
}

function genLabel(w: WorkspaceSummary): string {
  if (!w.doc.generatedAt) return t("launcher.notGenerated");
  return t("launcher.generated", {
    when: fmtRelative(w.doc.generatedAt, Date.now(), s.prefs.lang),
    effort: w.doc.effort ? t(`gen.effort.${w.doc.effort}`) : "",
  });
}
</script>

<main id="main" class="launcher" tabindex="-1" data-chrome>
  <h1>{t("brand.name")}</h1>
  <form class="open" onsubmit={open}>
    <label class="sr-only" for="ws-target">{t("launcher.inputLabel")}</label>
    <input id="ws-target" type="text" autocomplete="off" spellcheck="false" placeholder={t("launcher.placeholder")} bind:value={target} aria-describedby={error ? "ws-err" : undefined} />
    <button type="submit" class="btn btn-pri" aria-disabled={busy}>{t("launcher.open")}</button>
  </form>
  {#if error}<p id="ws-err" class="err" role="alert"><Rich text={error} /></p>{/if}

  <h2 class="rail-label">{t("launcher.recent")}</h2>
  {#if s.session.workspacesLoaded && list.length === 0}
    <p class="empty"><Rich text={t("launcher.empty")} /></p>
  {/if}
  <ul class="cards">
    {#each list as w (w.info.key)}
      <li>
        <a class="wcard" href={HREFS.map(w.info.key)}>
          <span class="l">
            <span class="name" data-user-content>{w.info.name}</span>
            {#if w.info.kind !== "git"}<span class="kind-badge">{t(w.info.kind === "shadow" ? "header.shadow" : "header.readonly")}</span>{/if}
            <span class="root mono" data-user-content>{w.info.root}</span>
          </span>
          <span class="r">
            <span>{genLabel(w)}</span>
            {#if w.counts.staleBlocks > 0}<span class="warn">&#x26A0;&#xFE0E;{w.counts.staleBlocks}</span>{/if}
            {#if w.counts.openThreads > 0}<span>&#x25CF;{w.counts.openThreads}</span>{/if}
            {#if w.counts.runningJobs > 0}<span class="run">&#x25D0;{w.counts.runningJobs}</span>{/if}
            {#if w.doc.commitsBehind !== null && w.doc.commitsBehind > 0}<span>{t("launcher.behind", { n: w.doc.commitsBehind })}</span>{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
</main>

<style>
  .launcher {
    max-width: 720px;
    margin: 0 auto;
    padding: 72px 24px 120px;
  }
  h1 {
    font-family: var(--font-serif);
    font-size: var(--fs-h1);
    font-weight: var(--fw-strong);
    letter-spacing: 0.06em;
    color: var(--ink);
    margin: 0 0 22px;
  }
  .open {
    display: flex;
    gap: 10px;
  }
  .open input {
    flex: 1;
    height: 44px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-input);
    padding: 0 14px;
    background: var(--sheet);
    color: var(--ink);
    font-size: var(--fs-ui-l);
  }
  .open .btn {
    height: 44px;
  }
  .err {
    color: var(--c-bad);
    margin: 8px 0 0;
  }
  .rail-label {
    margin-top: 34px;
  }
  .empty {
    color: var(--muted);
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wcard {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    min-height: 64px;
    padding: 12px 16px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    align-items: center;
  }
  .wcard:hover {
    border-color: var(--rule-2);
  }
  .l {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    min-width: 0;
  }
  .name {
    font-weight: var(--fw-strong);
    color: var(--ink);
    font-size: var(--fs-ui-l);
  }
  .root {
    flex-basis: 100%;
    font-size: var(--fs-label);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .r {
    display: flex;
    gap: 10px;
    font-size: var(--fs-label);
    color: var(--muted);
    white-space: nowrap;
  }
  .warn {
    color: var(--c-warn);
  }
  .run {
    color: var(--c-run);
  }
</style>
