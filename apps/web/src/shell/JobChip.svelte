<!--
  Header job chip (ux.md §3.3-8, contract `JobChipProps`): ◐ running · 🔒 waiting for lock · ◆ ready. Hidden when all
  counts are 0 (no reserved slot: it only appears after a user action, and the header groups are content-sized so
  nothing overlaps). Opens the 440 px job popover.
-->
<script lang="ts">
import { HREFS } from "@mitori/core";
import { useStores } from "../stores/app.svelte.ts";
import { t } from "./index.ts";

let { running, locked, ready }: { running: number; locked: number; ready: number } = $props();
const s = useStores();
let open = $state(false);
const empty = $derived(running + locked + ready === 0);
const ws = $derived("ws" in s.router.route ? s.router.route.ws : null);
const jobs = $derived([...s.review.jobs.values()].filter((j) => ["preparing", "running", "gating", "repairing", "waiting_lock", "ready"].includes(j.state)));

function toggle() {
  open = !open;
  if (open) s.layers.open("popover", "jobs-pop", () => (open = false));
  else s.layers.drop("jobs-pop");
}
</script>

<div class="chip-slot">
  {#if !empty}
    <button type="button" class="chip" aria-haspopup="true" aria-expanded={open} aria-label={t("header.jobs", { running, locked, ready })} onclick={toggle}>
      {#if running > 0}<span class="g run"><svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" /><path d="M7 1.5a5.5 5.5 0 0 1 0 11z" /></svg>{running}</span>{/if}
      {#if locked > 0}<span class="g lock"><svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="6" width="8" height="6" rx="1" /><path d="M5 6V4.5a2 2 0 0 1 4 0V6" /></svg>{locked}</span>{/if}
      {#if ready > 0}<span class="g ready"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5 12.5 7 7 12.5 1.5 7z" /></svg>{ready}</span>{/if}
    </button>
  {/if}
  {#if open}
    <div class="pop jobs" role="dialog" aria-label={t("header.jobsTitle")}>
      {#each jobs as j (j.id)}
        <a href={ws && j.state === "ready" ? HREFS.review(ws, j.id) : "#"} class="row">
          <span class="st">{t(`header.jobState.${j.state === "ready" ? "ready" : j.state === "waiting_lock" ? "locked" : "running"}`)}</span>
          <span class="mono">{j.route.mode}</span>
        </a>
      {:else}
        <p class="empty">{t("header.noJobs")}</p>
      {/each}
      {#if ws}<a class="more" href={`/w/${ws}/inbox?f=working`}>{t("header.inboxWorking")}</a>{/if}
    </div>
  {/if}
</div>

<style>
  .chip-slot {
    position: relative;
    display: flex;
    justify-content: flex-end;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    background: var(--sheet);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text);
  }
  .chip:hover {
    border-color: var(--rule-2);
  }
  .g {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .g svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
  }
  .run {
    color: var(--c-run);
  }
  .run path {
    fill: currentColor;
  }
  .lock {
    color: var(--c-warn);
  }
  .ready {
    color: var(--c-prop);
  }
  .ready path {
    fill: currentColor;
  }
  .jobs {
    top: 40px;
    right: 0;
    width: var(--jobs-pop-w);
    padding: 8px;
    position: absolute;
  }
  .row {
    display: flex;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: var(--r-btn);
    font-size: var(--fs-ui);
  }
  .row:hover {
    background: var(--hover);
  }
  .empty {
    margin: 8px 10px;
    color: var(--muted);
  }
  .more {
    display: block;
    border-top: 1px solid var(--rule-soft);
    margin-top: 6px;
    padding: 8px 10px 4px;
    color: var(--muted);
    font-size: var(--fs-label);
  }
</style>
