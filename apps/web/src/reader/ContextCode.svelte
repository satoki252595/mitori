<!-- First-use code column: window fetch, invalidation, resizer and CodePane. -->
<script lang="ts">
import { type FileContent, type LineNo, MitoriError, type RepoPath } from "@mitori/core";
import { errorText, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import CodePane from "./CodePane.svelte";
import { codeWindow, loadCode } from "./code.ts";

let {
  placement,
  width,
  spy,
  rev,
  onwidth,
}: {
  placement: "column" | "overlay" | "sheet" | "none";
  width: number;
  spy: { path: RepoPath; start: LineNo; end: LineNo; blob?: string } | null;
  rev: number;
  onwidth: (px: number) => void;
} = $props();
const s = useStores();
const target = $derived(s.ctx.pin ?? spy);
let content = $state.raw<FileContent | null>(null);
let error = $state<string | null>(null);

$effect(() => {
  const tg = target;
  const ws = s.workspace.key;
  void rev;
  if (!tg || !ws) return;
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

    {#if placement === "column"}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="grip" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></div>
    {/if}
    <div class="code-wrap">
      {#if target}
        <CodePane {content} range={{ start: target.start, end: target.end }} badge={s.ctx.pin ? "pinned" : "exact"} {error} citedBlob={target.blob ?? null} />
      {:else}
        <p class="empty">{t("ctx.codeEmpty")}</p>
      {/if}
      {#if placement === "column"}
        <label class="wctl"
          ><span>{t("ctx.width")}</span><input type="range" min="420" max="900" step="24" value={width} aria-valuetext={`${width}px`} oninput={(e) => onwidth(Number(e.currentTarget.value))} /></label
        >
      {/if}
    </div>

<style>
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
  .empty {
    padding: 24px 22px;
    color: var(--muted);
    font-size: var(--fs-ui);
    margin: 0;
  }
</style>
