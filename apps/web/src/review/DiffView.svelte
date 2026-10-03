<!--
  DiffView (contract `DiffViewProps`, ux.md §6.6, JUDGEMENT §6.7-6): under `staticDiffMaxLines` (2,000) the diff is ONE
  client-built HTML string (escaped; 2 DOM nodes per line) inserted once; decisions and the focused hunk are applied as
  attributes. At ≥ 2,000 lines, or in Split (widened panel only), the `cm6` + `merge` chunks are imported on demand
  (never before the Review opens) and replace the first 400 static lines; hunk decisions then come from the header
  list above the editors. One delegated click listener on the root.
-->
<script lang="ts">
import type { FileDiff, HunkId } from "@mitori/core";
import { onDestroy, onMount, untrack } from "svelte";
import { type DiffViewProps, UI_THRESHOLDS } from "../contract.ts";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { diffLineCount, mergeTexts, renderDiffHtml } from "./diff-html.ts";

let {
  files,
  focus,
  decisions,
  view,
  version = 0,
  ondecide,
}: DiffViewProps & { version?: number; ondecide: (unit: string, d: "accept" | "reject") => void } = $props();

let root: HTMLDivElement | undefined = $state();
let cmHost: HTMLDivElement | undefined = $state();
const lines = $derived(diffLineCount(files));
const big = $derived(lines >= UI_THRESHOLDS.staticDiffMaxLines);
const useCm = $derived(big || view === "split");
let cmReady = $state(false);
let cmError = $state(false);
const labels = { accept: t("review.diff.accept"), reject: t("review.diff.reject"), binary: t("review.diff.binary") };
const html = $derived(renderDiffHtml(files, labels, useCm ? 400 : Number.POSITIVE_INFINITY));
const collapsedByDefault = $derived(lines >= UI_THRESHOLDS.virtualizeDiffLines);

// decisions + focus as attributes (no re-render of the HTML)
$effect(() => {
  void version;
  void html;
  const f = focus;
  const d = decisions;
  if (!root) return;
  untrack(() => {
    for (const el of root?.querySelectorAll<HTMLElement>(".hunk[data-hunk]") ?? []) {
      const id = el.dataset.hunk as HunkId;
      const v = d.get(id);
      if (v) el.dataset.dec = v;
      else delete el.dataset.dec;
      if (id === f) {
        el.setAttribute("aria-current", "true");
        el.scrollIntoView({ block: "nearest" });
      } else el.removeAttribute("aria-current");
    }
    for (const el of root?.querySelectorAll<HTMLElement>(".dfile[data-path]") ?? []) {
      const ids = files.find((x) => x.path === el.dataset.path)?.hunks.map((h) => h.id) ?? [];
      const all =
        ids.length > 0 && ids.every((h) => d.get(h) === "accept") ? "accept" : ids.length > 0 && ids.every((h) => d.get(h) === "reject") ? "reject" : null;
      if (all) el.dataset.dec = all;
      else delete el.dataset.dec;
    }
  });
});

function onClick(e: MouseEvent) {
  const b = (e.target as Element).closest<HTMLElement>("button[data-act]");
  if (!b?.dataset.unit) return;
  ondecide(b.dataset.unit, b.dataset.act === "reject" ? "reject" : "accept");
}

// ---------------------------------------------------------------- CM6 + merge (lazy chunks)
let views: { destroy(): void }[] = [];
async function mountCm(list: readonly FileDiff[], split: boolean) {
  if (!cmHost) return;
  try {
    const [{ EditorView, lineNumbers }, { EditorState }, merge] = await Promise.all([
      import("@codemirror/view"),
      import("@codemirror/state"),
      import("@codemirror/merge"),
    ]);
    for (const v of views) v.destroy();
    views = [];
    cmHost.replaceChildren();
    for (const f of list) {
      if (f.binary) continue;
      const m = mergeTexts(f);
      const box = document.createElement("section");
      box.className = "cm-file";
      box.dataset.path = f.path;
      const h = document.createElement("header");
      h.className = "dfile-h";
      h.textContent = f.path;
      box.append(h);
      cmHost.append(box);
      const ro = [EditorView.editable.of(false), EditorState.readOnly.of(true)];
      if (split) {
        const mv = new merge.MergeView({
          a: { doc: m.a, extensions: [...ro, lineNumbers({ formatNumber: (n) => String(m.aLines[n - 1] ?? "") })] },
          b: { doc: m.b, extensions: [...ro, lineNumbers({ formatNumber: (n) => String(m.bLines[n - 1] ?? "") })] },
          parent: box,
          gutter: true,
          collapseUnchanged: collapsedByDefault ? { margin: 3, minSize: 8 } : undefined,
        } as never);
        views.push(mv);
      } else {
        const ev = new EditorView({
          parent: box,
          state: EditorState.create({
            doc: m.b,
            extensions: [
              ...ro,
              lineNumbers({ formatNumber: (n) => String(m.bLines[n - 1] ?? "") }),
              merge.unifiedMergeView({
                original: m.a,
                mergeControls: false,
                gutter: true,
                ...(collapsedByDefault ? { collapseUnchanged: { margin: 3, minSize: 8 } } : {}),
              }),
            ],
          }),
        });
        views.push(ev);
      }
    }
    cmReady = true;
    markAfterPaint("mitori:review:diff-mounted", { cm6: true });
  } catch {
    cmError = true;
  }
}

$effect(() => {
  if (!useCm) {
    cmReady = false;
    return;
  }
  const list = files;
  const split = view === "split";
  untrack(() => void mountCm(list, split));
});

onMount(() => {
  if (!useCm) markAfterPaint("mitori:review:diff-mounted", { cm6: false });
});
onDestroy(() => {
  for (const v of views) v.destroy();
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (delegated: the targets are buttons) -->
<div class="diff" bind:this={root} onclick={onClick} data-view={view}>
  {#if useCm && cmReady && !cmError}
    <ul class="hunknav" aria-label={t("review.diff.hunks")}>
      {#each files as f (f.path)}
        {#each f.hunks as h (h.id)}
          <li class="hunk" data-hunk={h.id}>
            <span class="mono">{f.path.split("/").pop()} @@ -{h.oldStart} +{h.newStart}</span>
            <span class="dec"><button type="button" class="dbtn ok" data-act="accept" data-unit={h.id} aria-label={labels.accept}>✓</button><button type="button" class="dbtn no" data-act="reject" data-unit={h.id} aria-label={labels.reject}>✕</button></span>
          </li>
        {/each}
      {/each}
    </ul>
  {:else}
    <div class="static">{@html html}</div>
    {#if useCm && !cmError}<p class="loading">{t("review.diff.loadingCm", { n: lines })}</p>{/if}
  {/if}
  <div class="cm" bind:this={cmHost} hidden={!(useCm && cmReady)}></div>
</div>

<style>
  .diff {
    font-size: var(--fs-label);
  }
  .diff :global(.dfile) {
    margin-bottom: 14px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    overflow: hidden;
  }
  .diff :global(.dfile-h) {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 6px 10px 6px 14px;
    border-bottom: 1px solid var(--rule);
    background: var(--sheet);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--ink);
  }
  .diff :global(.dfile-h .fs) {
    font-size: var(--fs-meta);
  }
  .diff :global(.ad) {
    color: var(--add-fg);
  }
  .diff :global(.de) {
    color: var(--del-fg);
  }
  .diff :global(.dec) {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
  }
  .diff :global(.dbtn) {
    width: 28px;
    height: 28px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-btn);
    background: var(--sheet);
    color: var(--muted);
    font-size: var(--fs-ui);
  }
  .diff :global(.dbtn:hover) {
    color: var(--ink);
  }
  .diff :global([data-dec="accept"] > .hunk-h .dbtn.ok),
  .diff :global([data-dec="accept"] > .dfile-h .dbtn.ok) {
    background: var(--c-ok-bg);
    border-color: var(--c-ok);
    color: var(--c-ok);
  }
  .diff :global([data-dec="reject"] > .hunk-h .dbtn.no),
  .diff :global([data-dec="reject"] > .dfile-h .dbtn.no) {
    background: var(--c-bad-bg);
    border-color: var(--c-bad);
    color: var(--c-bad);
  }
  .diff :global(.hunk-h) {
    position: sticky;
    top: 40px;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px 4px 14px;
    border-left: 3px solid transparent;
    background: var(--paper-2);
    font-size: var(--fs-meta);
    color: var(--c-run);
  }
  .diff :global(.hunk[aria-current="true"] > .hunk-h) {
    border-left-color: var(--c-prop);
    background: var(--c-prop-bg);
  }
  .diff :global(.hunk[data-dec="reject"] .dl) {
    opacity: 0.5;
  }
  .diff :global(.dl) {
    position: relative;
    padding: 1px 12px 1px calc(var(--lnw, 3ch) * 2 + 5ch + 1.5em);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.75;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    text-indent: -1.5em;
    color: var(--text);
  }
  .diff :global(.dl)::before {
    content: attr(data-l);
    position: absolute;
    left: 10px;
    white-space: pre;
    text-indent: 0;
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .diff :global(.dl.a) {
    background: var(--add-bg);
    color: var(--add-code);
  }
  .diff :global(.dl.d) {
    background: var(--del-bg);
    color: var(--del-code);
  }
  .diff :global(.dl.a .wd) {
    background: var(--add-hl);
  }
  .diff :global(.dl.d .wd) {
    background: var(--del-hl);
  }
  .diff :global(.dbin) {
    padding: 8px 14px;
    color: var(--muted);
  }
  .hunknav {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
  }
  .hunknav .hunk {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 12px;
    border-bottom: 1px solid var(--rule-soft);
  }
  .hunknav :global(.hunk[aria-current="true"]) {
    background: var(--c-prop-bg);
  }
  .loading {
    color: var(--muted);
  }
  .cm :global(.cm-file) {
    margin-bottom: 14px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    overflow: hidden;
    background: var(--sheet);
  }
  .cm :global(.cm-editor) {
    font-size: var(--fs-label);
  }
</style>
