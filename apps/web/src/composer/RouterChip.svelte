<!--
  Router chip (contract `RouterChipProps`, ux.md §6.2.7, UXP-28): `patch · 46 行 · 2 ファイル · claude-sonnet-5-5`,
  `agent · 3 ファイル > 2 → Read + Edit`, `answer · claude-sonnet-5-5`. A menu overrides mode and model for this
  thread only (the server router still validates). The title explains what each mode may touch.
-->
<script lang="ts">
import type { ClaudeModelId, ExecMode } from "@mitori/core";
import { t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";

let {
  mode,
  lines,
  files,
  model,
  reason,
  maxLines = 120,
  maxFiles = 2,
  override,
  onoverride,
}: {
  mode: ExecMode;
  lines: number;
  files: number;
  model: string;
  reason: "small_change" | "large_change" | "intent_question" | "intent_review" | null;
  maxLines?: number;
  maxFiles?: number;
  override: { mode?: ExecMode; model?: string } | undefined;
  onoverride: (o: { mode?: ExecMode; model?: ClaudeModelId } | undefined) => void;
} = $props();

const s = useStores();
let open = $state(false);
const MODES: ExecMode[] = ["answer", "patch", "agent"];
const MODELS: ClaudeModelId[] = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"];

const label = $derived.by(() => {
  if (mode === "answer") return `answer · ${model}`;
  if (mode === "agent") {
    const why =
      files > maxFiles
        ? t("composer.router.filesOver", { n: files, max: maxFiles })
        : lines > maxLines
          ? t("composer.router.linesOver", { n: lines, max: maxLines })
          : t("composer.router.files", { n: files });
    return `agent · ${why} → Read + Edit`;
  }
  return `patch · ${t("composer.router.lines", { n: lines })} · ${t("composer.router.files", { n: files })} · ${model}`;
});

function toggle() {
  open = !open;
  if (open) s.layers.open("menu", "router-menu", () => (open = false));
  else s.layers.drop("router-menu");
}
function pick(o: { mode?: ExecMode; model?: ClaudeModelId } | undefined) {
  onoverride(o);
  s.layers.close("router-menu", { restoreFocus: true });
}
</script>

<span class="rc-wrap">
  <button type="button" class="rc mono" class:ovr={!!override} aria-haspopup="menu" aria-expanded={open} title={t("composer.router.help", { files })} onclick={toggle} data-chrome
    >{label}{#if reason === "large_change" && lines > maxLines && files <= maxFiles}<span class="why"> · {t("composer.router.linesOver", { n: lines, max: maxLines })}</span>{/if}</button
  >
  {#if open}
    <div class="rc-menu" role="menu" data-chrome>
      <p class="h">{t("composer.router.mode")}</p>
      {#each MODES as m (m)}
        <button type="button" role="menuitemradio" aria-checked={(override?.mode ?? mode) === m} onclick={() => pick({ ...override, mode: m } as never)}>{m}<span class="d">{t(`composer.router.modeHelp.${m}`)}</span></button>
      {/each}
      <p class="h">{t("composer.router.model")}</p>
      {#each MODELS as m (m)}
        <button type="button" role="menuitemradio" aria-checked={(override?.model ?? model) === m} class="mono" onclick={() => pick({ ...override, model: m } as never)}>{m}</button>
      {/each}
      {#if override}<button type="button" role="menuitem" class="reset" onclick={() => pick(undefined)}>{t("composer.router.reset")}</button>{/if}
    </div>
  {/if}
</span>

<style>
  .rc-wrap {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }
  .rc {
    height: 24px;
    padding: 0 8px;
    border-radius: var(--r-chip-l);
    border: 1px solid var(--rule);
    background: var(--sheet);
    color: var(--muted);
    font-size: var(--fs-meta);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .rc:hover {
    color: var(--ink);
    border-color: var(--rule-2);
  }
  .rc.ovr {
    border-color: var(--accent);
    color: var(--ink);
  }
  .why {
    color: var(--c-warn);
  }
  .rc-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 6px);
    z-index: var(--z-popover);
    min-width: 260px;
    padding: 6px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    box-shadow: var(--shadow-pop);
  }
  .rc-menu .h {
    margin: 6px 6px 2px;
    font-size: var(--fs-meta);
    color: var(--muted);
    letter-spacing: var(--ls-caps);
  }
  .rc-menu button {
    display: flex;
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
    padding: 5px 8px;
    border-radius: var(--r-btn);
    font-size: var(--fs-label);
    color: var(--text);
    text-align: left;
  }
  .rc-menu button[aria-checked="true"] {
    background: var(--hover);
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .rc-menu button:hover {
    background: var(--hover);
  }
  .rc-menu .d {
    font-weight: var(--fw-regular);
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .rc-menu .reset {
    margin-top: 4px;
    color: var(--accent);
  }
</style>
