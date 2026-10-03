<!--
  CodePane (contract `CodePaneProps`; context column code mode and S3): sticky header
  `{dir}{base} [exact|search|pinned|uncommitted] … {blob7} · L{a}–{b}`, server Shiki HTML, the cited range marked
  (`--mark-line` + 2 px accent on the number column). Lines are server HTML — no per-line components.
-->
<script lang="ts">
import type { FileContent, LineNo } from "@mitori/core";
import { t } from "../shell/index.ts";

let {
  content,
  range,
  badge,
  error,
}: { content: FileContent | null; range: { start: LineNo; end: LineNo }; badge: "exact" | "search" | "pinned" | "uncommitted"; error: string | null } =
  $props();
let body: HTMLPreElement | undefined = $state();

$effect(() => {
  const c = content;
  const r = range;
  if (!body || !c) return;
  for (const ln of body.querySelectorAll<HTMLElement>("[data-line]")) {
    const n = Number(ln.dataset.line);
    ln.classList.toggle("hi", n >= r.start && n <= r.end);
  }
  const first = body.querySelector<HTMLElement>(".hi");
  if (first) body.scrollTop = Math.max(0, first.offsetTop - 40);
});

const dir = $derived(content ? content.path.slice(0, content.path.lastIndexOf("/") + 1) : "");
const base = $derived(content ? content.path.slice(content.path.lastIndexOf("/") + 1) : "");
</script>

<div class="cpane" data-chrome>
  <div class="cph">
    {#if content}
      <span class="path mono" data-user-content><span class="dir">{dir}</span>{base}</span>
      <span class="badge">{t(`code.badge.${badge}`)}</span>
      <span class="meta mono">{content.blob.slice(0, 7)} &middot; L{range.start}&ndash;{range.end}</span>
    {:else}
      <span class="skel path-skel">&nbsp;</span>
    {/if}
  </div>
  {#if error}
    <p class="err" role="alert">{error}</p>
  {:else if content?.html}
    <pre class="mcode shiki cbody" bind:this={body} data-user-content>{@html content.html}</pre>
  {:else if content}
    <pre class="mcode cbody" bind:this={body} data-user-content>{content.text}</pre>
  {:else}
    <div class="cbody skel" aria-busy="true"></div>
  {/if}
</div>

<style>
  .cpane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--sheet);
    border-left: 1px solid var(--rule);
  }
  .cph {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border-bottom: 1px solid var(--rule);
    background: var(--paper);
    flex: none;
  }
  .path {
    font-size: var(--fs-label);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .dir {
    color: var(--muted);
  }
  .badge {
    font-size: var(--fs-meta);
    color: var(--muted);
    border: 1px solid var(--rule);
    border-radius: var(--r-pill);
    padding: 0 7px;
    white-space: nowrap;
  }
  .meta {
    margin-left: auto;
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
  }
  .path-skel {
    width: 18em;
    height: 1em;
  }
  .cbody {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 8px 0;
    overflow: auto;
    font: 0.75rem / var(--lh-code) var(--font-mono);
    color: var(--shiki-foreground);
    font-variant-ligatures: none;
  }
  .cbody :global([data-line]) {
    display: block;
    padding-right: 16px;
  }
  .cbody :global([data-line].hi) {
    background: var(--mark-line);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .err {
    padding: 16px;
    color: var(--c-bad);
  }
</style>
