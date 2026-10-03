<!--
  Status pill (ux.md §6.9, contract `STATUS_PRESENTATION`): shape + colour + label, the three together. `bare`
  drops the surface (inline in a meta line); `glyphOnly` keeps an accessible name.
-->
<script lang="ts">
import { STATUS_PRESENTATION, type UiStatus } from "../contract.ts";
import { t } from "../shell/index.ts";
import Glyph from "./Glyph.svelte";

let { status, bare = false, glyphOnly = false, label = null }: { status: UiStatus; bare?: boolean; glyphOnly?: boolean; label?: string | null } = $props();
const p = $derived(STATUS_PRESENTATION[status]);
const text = $derived(label ?? t(`status.${status}`));
</script>

{#if glyphOnly}
  <span class="sp-g" style:color="var({p.color})" role="img" aria-label={text}><Glyph name={p.glyph} /></span>
{:else}
  <span class="st-tag sp" class:bare data-status={status} style:--sp-c="var({p.color})"><Glyph name={p.glyph} /><span>{text}</span></span>
{/if}

<style>
  .sp {
    color: var(--sp-c);
    background: color-mix(in srgb, var(--sp-c) 9%, var(--sheet));
  }
  .sp.bare {
    background: none;
    padding: 0;
  }
  .sp[data-status="ready"] {
    background: var(--c-prop-bg);
  }
  .sp[data-status="running"],
  .sp[data-status="gating"],
  .sp[data-status="repairing"] {
    background: var(--c-run-bg);
  }
  .sp[data-status="applied"],
  .sp[data-status="answered"],
  .sp[data-status="resolved"],
  .sp[data-status="partially_applied"] {
    background: var(--c-ok-bg);
  }
  .sp[data-status="failed"] {
    background: var(--c-bad-bg);
  }
  .sp[data-status="outdated"],
  .sp[data-status="stale"],
  .sp[data-status="needs_choice"],
  .sp[data-status="needs_input"],
  .sp[data-status="waiting_lock"] {
    background: var(--c-warn-bg);
  }
  .sp.bare[data-status] {
    background: none;
  }
  .sp-g {
    display: inline-flex;
  }
</style>
