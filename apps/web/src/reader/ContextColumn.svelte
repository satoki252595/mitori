<!--
  Context column (contract `ContextColumnStore` modes, ux.md §4.4): margin (thread cards / Composer / job cards —
  the loop UI of WP-10b plugs in through `UiExtension.margin`), code (CodePane, pinned or scrollspy-driven), review
  (640 px or right overlay; `UiExtension.reviewPanel`). Placement (column / overlay / bottom sheet) comes from
  the container-width layout (UXP-03).
-->
<script lang="ts">
import type { FileContent, JobId, LineNo, RepoPath, SectionId } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import type { Component } from "svelte";
import { errorText, t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import Rich from "../shell/Rich.svelte";
import { useStores } from "../stores/app.svelte.ts";
import CodePane from "./CodePane.svelte";
import { codeWindow, loadCode } from "./code.ts";

let {
  placement,
  width,
  page,
  spy,
  margin,
  review,
  onwidth,
}: {
  placement: "column" | "overlay" | "sheet" | "none";
  width: number;
  page: SectionId;
  spy: { path: RepoPath; start: LineNo; end: LineNo } | null;
  margin: Component<{ page: string }> | null;
  review: Component<{ job: JobId }> | null;
  onwidth: (px: number) => void;
} = $props();

const s = useStores();
const mode = $derived(s.ctx.mode);
const target = $derived(s.ctx.pin ?? spy);
let content = $state.raw<FileContent | null>(null);
let error = $state<string | null>(null);

$effect(() => {
  const m = mode;
  markAfterPaint("mitori:ctx:mode", { mode: m });
});

$effect(() => {
  const tg = target;
  const ws = s.workspace.key;
  if (mode !== "code" || !tg || !ws) return;
  const w = codeWindow(tg.start, tg.end);
  error = null;
  loadCode(s.api, ws, tg.path, w.start, w.end).then(
    (c) => {
      if (target === tg) content = c;
    },
    (err) => (error = errorText(MitoriError.from(err).toData())),
  );
});

// drag the column edge (pointer only; the keyboard path is the range input below — WCAG 2.5.7)
let dragX: number | null = null;
function down(e: PointerEvent) {
  dragX = e.clientX;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (dragX === null) return;
  const d = dragX - e.clientX;
  if (Math.abs(d) >= 4) {
    onwidth(width + d);
    dragX = e.clientX;
  }
}
function up() {
  dragX = null;
}
</script>

<aside class="ctx" data-mode={mode} data-place={placement} style:width={placement === "column" ? `${width}px` : undefined} aria-label={t(`ctx.${mode}`)}>
  {#if mode === "code"}
    {#if placement === "column"}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="grip" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></div>
    {/if}
    <div class="code-wrap">
      {#if target}
        <CodePane {content} range={{ start: target.start, end: target.end }} badge={s.ctx.pin ? "pinned" : "exact"} {error} />
      {:else}
        <p class="empty">{t("ctx.codeEmpty")}</p>
      {/if}
      {#if placement === "column"}
        <label class="wctl"
          ><span>{t("ctx.width")}</span><input type="range" min="420" max="900" step="24" value={width} aria-valuetext={`${width}px`} oninput={(e) => onwidth(Number(e.currentTarget.value))} /></label
        >
      {/if}
    </div>
  {:else if mode === "review"}
    {#if review && s.ctx.job}
      {@const Review = review}
      <Review job={s.ctx.job} />
    {:else}
      <div class="review-ph" data-chrome>
        <p class="t">{t("ctx.reviewTitle")}</p>
        <p>{t("ctx.reviewPending")}</p>
      </div>
    {/if}
  {:else if margin}
    {@const Margin = margin}
    <Margin {page} />
  {:else}
    <div class="margin-empty" data-chrome><p><Rich text={t("ctx.marginEmpty")} /></p></div>
  {/if}
</aside>

<style>
  .ctx {
    position: relative;
    min-width: 0;
    border-left: 1px solid var(--rule-soft);
  }
  .ctx[data-mode="code"][data-place="column"],
  .ctx[data-mode="review"][data-place="column"] {
    position: sticky;
    top: var(--hdr);
    height: calc(100vh - var(--hdr) - var(--status));
    align-self: start;
  }
  .ctx[data-place="overlay"] {
    position: fixed;
    right: 0;
    top: var(--hdr);
    bottom: var(--status);
    width: min(640px, calc(100% - 48px));
    z-index: var(--z-overlay);
    background: var(--paper);
    box-shadow: var(--shadow-pop);
  }
  .ctx[data-place="sheet"] {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--status);
    height: var(--sheet-half);
    z-index: var(--z-sheet);
    background: var(--paper);
    border-top: 1px solid var(--rule);
    border-left: 0;
    border-radius: 14px 14px 0 0;
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .ctx[data-place="sheet"][data-mode="margin"] {
    display: none;
  }
  .code-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .grip {
    position: absolute;
    left: -4px;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: var(--z-sticky);
  }
  .wctl {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 12px;
    border-top: 1px solid var(--rule);
    font-size: var(--fs-label);
    color: var(--muted);
    background: var(--paper);
  }
  .wctl input {
    flex: 1;
    accent-color: var(--accent);
  }
  .empty,
  .margin-empty p {
    padding: 24px 22px;
    color: var(--muted);
    font-size: var(--fs-ui);
    margin: 0;
  }
  .margin-empty {
    position: sticky;
    top: calc(var(--hdr) + 40vh);
  }
  .review-ph {
    padding: 24px;
    color: var(--muted);
  }
  .review-ph .t {
    font-family: var(--font-serif);
    font-size: var(--fs-title-s);
    color: var(--ink);
    font-weight: var(--fw-strong);
    margin: 0 0 8px;
  }
</style>
