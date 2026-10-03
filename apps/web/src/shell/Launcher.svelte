<!--
  S0 Launcher (ux.md §4.1): open a path or GitHub URL, recent workspaces (last opened first). Errors go under the
  input with role="alert". Cards are links with a roving tabindex: one Tab stop, ↑↓ / Home / End move, Enter opens.
-->
<script lang="ts">
import { HREFS, MitoriError, type WorkspaceSummary } from "@mitori/core";
import { useStores } from "../stores/app.svelte.ts";
import { copyText } from "./clipboard.ts";
import { ellipsizeMiddle, fmtRelative } from "./fmt.ts";
import { errorText, isComposing, t } from "./index.ts";
import { markAfterPaint } from "./perf.ts";
import Rich from "./Rich.svelte";

const s = useStores();
let target = $state("");
let busy = $state(false);
let error = $state<string | null>(null);
let cloneFailed = $state(false);
let current = $state(0);
const list = $derived(s.session.workspaces);

$effect(() => {
  void s.session.loadWorkspaces().finally(() => {
    markAfterPaint("mitori:section:rendered", { id: "launcher" });
    s.router.painted();
  });
});

async function open(e: SubmitEvent) {
  e.preventDefault();
  if (busy) return;
  const v = target.trim();
  cloneFailed = false;
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
    const me = MitoriError.from(err);
    error = errorText(me.toData());
    cloneFailed = me.code === "E_GIT_CLONE_FAILED";
  } finally {
    busy = false;
  }
}

/** ↑↓ / Home / End between the cards (roving tabindex; Enter is the link's own activation). */
function onCardsKey(e: KeyboardEvent) {
  if (isComposing(e)) return;
  const n = list.length;
  if (n === 0) return;
  const next = e.key === "ArrowDown" ? current + 1 : e.key === "ArrowUp" ? current - 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
  if (next === null || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  current = Math.max(0, Math.min(n - 1, next));
  (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("a.wcard")[current]?.focus();
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
  {#if error}
    <p id="ws-err" class="err" role="alert">
      <Rich text={error} />
      {#if cloneFailed}<button type="button" class="btn btn-sec btn-s" onclick={() => copyText("gh auth login", s, "copy.command")}>{t("banner.copyCommand")}</button>{/if}
    </p>
  {/if}

  <h2 class="rail-label">{t("launcher.recent")}</h2>
  {#if s.session.workspacesLoaded && list.length === 0}
    <p class="empty"><Rich text={t("launcher.empty")} /></p>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (arrow keys between the card links) -->
  <ul class="cards" onkeydown={onCardsKey}>
    {#each list as w, i (w.info.key)}
      <li>
        <a class="wcard" href={HREFS.map(w.info.key)} tabindex={i === Math.min(current, list.length - 1) ? 0 : -1} onfocus={() => (current = i)}>
          <span class="l">
            <span class="name" data-user-content>{w.info.name}</span>
            {#if w.info.kind !== "git"}<span class="kind-badge">{t(w.info.kind === "shadow" ? "header.shadow" : "header.readonly")}</span>{/if}
            <span class="root mono" data-user-content title={w.info.root}>{ellipsizeMiddle(w.info.root, 72)}</span>
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
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
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
