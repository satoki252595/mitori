<!--
  Status glyphs (contract `StatusGlyph`, ux.md §6.9): inline SVG on one 14×14 grid, never emoji, always
  `aria-hidden` — the label next to it (pill) or the owner's `aria-label` names the state (WCAG 1.4.1).
-->
<script lang="ts">
import type { StatusGlyph } from "../contract.ts";

let { name, size = 13 }: { name: StatusGlyph; size?: number } = $props();
</script>

<svg class="sg" width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
  {#if name === "circle-dotted"}
    <circle cx="7" cy="7" r="5.2" stroke-dasharray="1.6 1.9" />
  {:else if name === "circle"}
    <circle cx="7" cy="7" r="5.2" />
  {:else if name === "dot"}
    <circle cx="7" cy="7" r="3.6" class="f" />
  {:else if name === "lock"}
    <rect x="3" y="6.2" width="8" height="5.8" rx="1.2" /><path d="M4.8 6.2V4.6a2.2 2.2 0 0 1 4.4 0v1.6" />
  {:else if name === "half"}
    <circle cx="7" cy="7" r="5.2" /><path d="M7 1.8a5.2 5.2 0 0 1 0 10.4z" class="f" />
  {:else if name === "diamond"}
    <path d="M7 1.6 12.4 7 7 12.4 1.6 7z" class="f" />
  {:else if name === "check-circle"}
    <circle cx="7" cy="7" r="5.6" class="f" /><path d="m4.4 7.2 1.8 1.8 3.5-3.6" class="k" />
  {:else if name === "half-check"}
    <circle cx="7" cy="7" r="5.2" /><path d="M7 1.8a5.2 5.2 0 0 1 0 10.4z" class="f" /><path d="m4 7.1 1.5 1.5" />
  {:else if name === "bubble"}
    <path d="M2.2 3.2h9.6v6H7.4l-2.8 2.2V9.2H2.2z" class="f" />
  {:else if name === "x-circle"}
    <circle cx="7" cy="7" r="5.6" class="f" /><path d="m4.9 4.9 4.2 4.2M9.1 4.9 4.9 9.1" class="k" />
  {:else if name === "warn"}
    <path d="M7 1.8 12.6 11.8H1.4z" class="f" /><path d="M7 5.4v3M7 10v.1" class="k" />
  {:else if name === "question-circle"}
    <circle cx="7" cy="7" r="5.6" class="f" /><path d="M5.5 5.5a1.6 1.6 0 1 1 2.1 1.5c-.4.2-.6.5-.6.9v.3M7 10v.1" class="k" />
  {:else if name === "undo"}
    <path d="M4.2 4.2H8.6a3 3 0 0 1 0 6H5" /><path d="M5.8 2.4 4 4.2l1.8 1.8" />
  {:else if name === "dash"}
    <path d="M3 7h8" />
  {:else if name === "refresh"}
    <path d="M11.4 7a4.4 4.4 0 1 1-1.3-3.1M11.6 2.4v2.4H9.2" />
  {/if}
</svg>

<style>
  .sg {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .sg :global(.f) {
    fill: currentColor;
    stroke: none;
  }
  .sg :global(.k) {
    stroke: var(--sheet);
    stroke-width: 1.5;
  }
</style>
