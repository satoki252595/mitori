<!--
  Loop overlays, mounted once at `install` outside the route views: the selection toolbar, the Composer as a bottom
  sheet when the margin column is not shown (code mode, < 1024 px), in-prose proposals, the PullBar, and the Finish /
  trust / undo-diverged / merge-conflict dialogs. Global loop keys: ⇧F 「まとめて送る」 (read and inbox scopes) and ⌘Z.
-->
<script lang="ts">
import type { ReviewEstimate, ThreadId } from "@mitori/core";
import { onMount, untrack } from "svelte";
import Composer from "../composer/Composer.svelte";
import SelectionToolbar from "../composer/SelectionToolbar.svelte";
import ProposalLayer from "../proposals/ProposalLayer.svelte";
import FinishDialog from "../review/FinishDialog.svelte";
import PullBar from "../review/PullBar.svelte";
import { t } from "../shell/index.ts";
import { viewKind } from "../shell/router.ts";
import { currentLayout, provideStores, type Stores } from "../stores/app.svelte.ts";
import TrustDialog from "../trust/TrustDialog.svelte";
import { loopOf } from "./loop.svelte.ts";

let { stores }: { stores: Stores } = $props();
const s = untrack(() => stores);
provideStores(s);
const loop = loopOf(s);
const kind = $derived(viewKind(s.router.route));
const onDoc = $derived(kind === "doc" || kind === "docReview");
const sheet = $derived(!!loop.composer && (!onDoc || currentLayout(s).ctxPlacement !== "column" || s.ctx.mode !== "margin"));
const ready = $derived(loop.readyJobs().length);
const pull = $derived((onDoc || kind === "inbox") && (loop.waiting?.clients ?? 0) > 0 && ready === 0);
const round = $derived.by(() => {
  const r = s.review.round?.round;
  return r && r.state === "collecting" ? r.n : (r?.n ?? 0) + 1;
});

// ---------------------------------------------------------------- Finish data
let est = $state.raw<ReviewEstimate | null>(null);
$effect(() => {
  if (!loop.finishOpen) return;
  untrack(() => {
    est = null;
    void loop.refreshReview().then(async () => {
      const ws = s.workspace.key;
      const pending = loop.pendingThreads;
      if (!ws || pending.length === 0) return;
      try {
        est = await s.api.call("POST /ws/:ws/review/estimate", { params: { ws }, body: { threads: [...pending] } });
      } catch {
        est = null;
      }
    });
  });
});
const labels = $derived.by(() => {
  const m = new Map<ThreadId, { title: string; path: string | null; sent: boolean }>();
  for (const th of s.review.threads.values()) m.set(th.id, { title: th.title || th.preview, path: th.anchor.code?.path ?? null, sent: !!th.sendToAi });
  return m;
});

async function finish(mode: "push" | "pull") {
  const e = est;
  const ok = await loop.finish(mode, { ...(mode === "push" && e ? { estimateId: e.estimateId, confirm: e.requiresConfirm } : {}) });
  if (ok) {
    s.layers.close("finish");
    s.bottom.toast({ id: "loop.finish", kind: "success", key: mode === "pull" ? "review.toast.sentPull" : "review.toast.sentPush", params: { n: round } });
  }
}

onMount(() => {
  const k = s.keys;
  const offs = [
    k.on("review.finish", () => (loop.finishOpen = true)),
    k.on("inbox.finish", () => (loop.finishOpen = true)),
    k.on("undo.last", () => void loop.undo.undo()),
  ];
  return () => {
    for (const off of offs) off();
  };
});
</script>

{#if onDoc}
  <SelectionToolbar />
  <ProposalLayer />
{/if}

{#if sheet && loop.composer}
  <div class="sheet">{#key loop.composer.tempKey}<Composer session={loop.composer} placement="sheet" showIds={s.doc.level === "expert"} />{/key}</div>
{/if}

{#if pull && loop.waiting}
  <div class="pullbar"><PullBar round={loop.waiting.round || round} agents={loop.waiting.agents} pending={loop.pendingThreads.length} onfinish={() => (loop.finishOpen = true)} /></div>
{/if}

{#if loop.finishOpen}
  <FinishDialog
    pending={loop.pendingThreads}
    estimate={est}
    singleTotalTokens={est?.separateTokens ?? null}
    waitingClients={loop.waiting?.clients ?? 0}
    heldNotes={s.review.round?.heldNotes ?? []}
    defaultMode={loop.execPath() === "pull" ? "pull" : "push"}
    onfinish={(m) => void finish(m)}
    {round}
    {labels}
    onclose={() => (loop.finishOpen = false)}
    onsendtoai={(id, on) => void loop.setSendToAi(id, on)}
  />
{/if}

{#if loop.trustOpen}
  {@const req = loop.trustOpen}
  <TrustDialog
    request={req}
    ondecide={async (d) => {
      await loop.decideTrust(req.id, d);
      s.layers.close("trust");
    }}
    onclose={() => (loop.trustOpen = null)}
  />
{/if}

{#if loop.undo.diverged}
  {@const dv = loop.undo.diverged}
  <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="dv-t" data-chrome>
    <div class="card box">
      <h2 id="dv-t">{t("review.diverged.title", { n: dv.files.length })}</h2>
      <ul class="files mono">{#each dv.files as f (f)}<li>{f}</li>{/each}</ul>
      <div class="row">
        <button type="button" class="btn btn-sec" onclick={() => loop.undo.keepDiverged()}>{t("review.diverged.keep")}</button>
        <button type="button" class="btn btn-pri warn" onclick={() => void loop.undo.forceUndo()}>{t("review.diverged.force")}</button>
      </div>
    </div>
  </div>
{/if}

{#if loop.dialog?.kind === "conflict"}
  {@const cf = loop.dialog}
  <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" data-chrome>
    <div class="card box">
      <h2 id="cf-t">{t("review.conflict.title", { files: cf.files.join(", ") })}</h2>
      <div class="row">
        <button type="button" class="btn btn-sec" onclick={() => { const ws = s.workspace.key; loop.dialog = null; if (ws) void s.router.go({ name: "review", ws, job: cf.job }); }}>{t("review.conflict.diff")}</button>
        <button type="button" class="btn btn-sec" onclick={() => { loop.dialog = null; void loop.revise(cf.job, t("review.conflict.reviseMsg")); }}>{t("review.conflict.revise")}</button>
        <button type="button" class="btn btn-gh" onclick={() => (loop.dialog = null)}>{t("review.close")}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--status);
    z-index: var(--z-sheet);
    max-height: var(--sheet-full);
    overflow: auto;
    padding: 0 12px;
  }
  .sheet :global(.composer) {
    max-width: 720px;
    margin: 0 auto;
  }
  .pullbar {
    position: fixed;
    top: calc(var(--hdr) + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-bottom);
    max-width: calc(100% - 32px);
  }
  .modal {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: grid;
    place-items: center;
    background: var(--scrim);
  }
  .box {
    width: min(520px, calc(100% - 32px));
    padding: 20px 22px;
    box-shadow: var(--shadow-pop);
  }
  .box h2 {
    margin: 0 0 12px;
    font-family: var(--font-serif);
    font-size: var(--fs-title-s);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .files {
    margin: 0 0 14px;
    padding-left: 1.2em;
    font-size: var(--fs-label);
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
