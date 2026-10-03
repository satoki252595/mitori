<!--
  Finish dialog 「R{n}を送る」 (contract `FinishDialogProps`, ux.md §5.3 / §4.6 R1, UXP-02 / UXP-10, AC-U-F01): the
  pending threads by module, the batch estimate (`POST /review/estimate`, CONS-08) with 「別々なら ≈k · p% 節約」, the
  held notes 「人向けのメモ{n}件（送らない）」 with a per-thread 『AIに送る』, and the two paths: my own session (pull —
  never switched to push because nobody waits; with 0 waiters the button prepares the round and `/mitori:review` is
  copied) or 「その場で実行」 (push). The dialog is the confirmation: above `confirmAboveTokens` the main button names the
  cost. ⌘⏎ sends (IME-guarded); Escape closes.
-->
<script lang="ts">
import type { ReviewEstimate, ThreadId } from "@mitori/core";
import { onMount, untrack } from "svelte";
import type { FinishDialogProps } from "../contract.ts";
import { commonScope } from "../inbox/view.ts";
import { copyText } from "../shell/clipboard.ts";
import { fmtTokens, fmtUsd, isComposing, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";

let {
  pending,
  estimate,
  singleTotalTokens,
  waitingClients,
  heldNotes,
  defaultMode,
  onfinish,
  round,
  onclose,
  onsendtoai,
  labels,
}: FinishDialogProps & {
  round: number;
  onclose: () => void;
  onsendtoai: (th: ThreadId, on: boolean) => void;
  labels: ReadonlyMap<ThreadId, { title: string; path: string | null; sent: boolean }>;
} = $props();

const s = useStores();
let dlg: HTMLDialogElement | undefined = $state();
let mode = $state<"push" | "pull">(untrack(() => defaultMode));
let busy = $state(false);

const saving = $derived(
  estimate && singleTotalTokens && singleTotalTokens > estimate.batchTokens ? Math.round((1 - estimate.batchTokens / singleTotalTokens) * 100) : null,
);
const groups = $derived.by(() => {
  const by = new Map<string, ThreadId[]>();
  for (const id of pending) {
    const p = labels.get(id)?.path ?? "";
    const key = commonScope([p]) ?? "—";
    by.set(key, [...(by.get(key) ?? []), id]);
  }
  return [...by.entries()];
});
const main = $derived.by(() => {
  if (pending.length === 0) return t("review.finish.approve");
  if (mode === "pull") return waitingClients > 0 ? t("review.finish.pull", { n: round }) : t("review.finish.prepare", { n: round });
  if (estimate?.requiresConfirm)
    return t("review.finish.runCost", { k: fmtTokens(estimate.batchTokens, { approx: true }), usd: fmtUsd(estimate.apiUsd, "job") });
  return t("review.finish.push");
});

onMount(() => {
  dlg?.showModal();
  s.layers.open("dialog", "finish", onclose);
  return () => s.layers.drop("finish");
});

async function go() {
  if (busy) return;
  busy = true;
  try {
    const m = pending.length === 0 ? "pull" : mode;
    onfinish(m);
    if (m === "pull" && waitingClients === 0 && pending.length > 0) await copyText("/mitori:review", s, "copy.command");
  } finally {
    busy = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (isComposing(e)) return;
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void go();
  }
}
const est: ReviewEstimate | null = $derived(estimate);
</script>

<dialog bind:this={dlg} class="fin" aria-labelledby="fin-t" onkeydown={onKey} onclose={() => s.layers.drop("finish")} data-chrome>
  <header>
    <h2 id="fin-t">{t("review.finish.title", { n: round })}</h2>
    <button type="button" class="btn btn-gh" aria-label={t("review.close")} onclick={() => s.layers.close("finish")}>×</button>
  </header>
  {#if pending.length === 0}
    <p class="empty">{t("review.finish.none")}</p>
  {:else}
    <ul class="groups">
      {#each groups as [scope, ids] (scope)}
        <li>
          <p class="scope mono">{scope}</p>
          <ul>
            {#each ids as id (id)}
              <li class="th" data-user-content>{labels.get(id)?.title ?? id}</li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
    <p class="est mono">
      {#if est}
        {t("review.finish.estimate", { k: fmtTokens(est.batchTokens, { approx: true }), usd: fmtUsd(est.apiUsd, "job"), parts: est.partitions.length })}
        {#if saving !== null && singleTotalTokens}<span class="save"> · {t("review.finish.saving", { k: fmtTokens(singleTotalTokens, { approx: true }), p: saving })}</span>{/if}
      {:else}
        <span class="skel">{t("review.finish.estimating")}</span>
      {/if}
    </p>
  {/if}
  {#if heldNotes.length > 0}
    <details class="held">
      <summary>{t("review.finish.held", { n: heldNotes.length })}</summary>
      <ul>
        {#each heldNotes as id (id)}
          <li><label><input type="checkbox" checked={labels.get(id)?.sent ?? false} onchange={(e) => onsendtoai(id, (e.currentTarget as HTMLInputElement).checked)} /><span data-user-content>{labels.get(id)?.title ?? id}</span><span class="k">{t("review.finish.sendToAi")}</span></label></li>
        {/each}
      </ul>
    </details>
  {/if}
  {#if pending.length > 0}
    <div class="modes" role="radiogroup" aria-label={t("review.finish.mode")}>
      <label class:on={mode === "pull"}><input type="radio" name="fin-mode" checked={mode === "pull"} onchange={() => (mode = "pull")} /><span><b>{t("review.finish.modePull")}</b><span class="d">{t("review.finish.modePullD", { n: waitingClients })}</span></span></label>
      <label class:on={mode === "push"}><input type="radio" name="fin-mode" checked={mode === "push"} onchange={() => (mode = "push")} /><span><b>{t("review.finish.modePush")}</b><span class="d">{t("review.finish.modePushD")}</span></span></label>
    </div>
    {#if mode === "pull" && waitingClients === 0}
      <p class="note">{t("review.finish.noWaiter")}</p>
    {/if}
  {/if}
  <footer>
    <button type="button" class="btn btn-sec" onclick={() => s.layers.close("finish")}>{t("review.cancel")}</button>
    <button type="button" class="btn btn-pri" disabled={busy || (mode === "push" && pending.length > 0 && !est)} onclick={() => void go()}>{main}<kbd>{s.keys.label("Mod+Enter")}</kbd></button>
  </footer>
</dialog>

<style>
  .fin {
    width: min(560px, calc(100% - 32px));
    padding: 20px 22px 18px;
    border: 1px solid var(--rule);
    border-radius: var(--r-dialog);
    background: var(--sheet);
    color: var(--text);
    box-shadow: var(--shadow-pop);
    font-size: var(--fs-ui);
  }
  .fin::backdrop {
    background: var(--scrim);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-title);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .empty {
    color: var(--muted);
  }
  .groups,
  .groups ul,
  .held ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .groups {
    margin-top: 14px;
    max-height: 260px;
    overflow: auto;
  }
  .scope {
    margin: 10px 0 4px;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .th {
    padding: 4px 0 4px 10px;
    border-left: 2px solid var(--rule);
    color: var(--ink);
  }
  .est {
    margin: 14px 0 0;
    font-size: var(--fs-label);
    color: var(--text);
  }
  .est .save {
    color: var(--c-ok);
  }
  .held {
    margin-top: 12px;
    font-size: var(--fs-label);
  }
  .held summary {
    cursor: pointer;
    color: var(--muted);
  }
  .held label {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
  }
  .held .k {
    margin-left: auto;
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .modes {
    display: grid;
    gap: 6px;
    margin-top: 14px;
  }
  .modes label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    cursor: pointer;
  }
  .modes label.on {
    border-color: var(--ink);
  }
  .modes input {
    margin-top: 3px;
    accent-color: var(--ink);
  }
  .modes b {
    display: block;
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .modes .d {
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .note {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  footer kbd {
    margin-left: 8px;
    background: none;
    color: inherit;
    border-color: color-mix(in srgb, var(--paper) 35%, transparent);
  }
</style>
