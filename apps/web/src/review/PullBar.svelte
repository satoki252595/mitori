<!--
  PullBar (contract `PullBarProps`, UXP-01, AC-U-P01): one sticky line in S2 / S4 while a `mitori review` waits and no
  job is ready — 「Claude Code（{agent}）がR{n}を待っています — 文を選んで c でコメント → ⇧F で渡す · 保留{k}件［渡す ⇧F］」.
-->
<script lang="ts">
import type { PullBarProps } from "../contract.ts";
import { t } from "../shell/index.ts";
import Rich from "../shell/Rich.svelte";

let { round, agents, pending, onfinish }: PullBarProps = $props();
const agent = $derived(agents.length ? agents.join(", ") : "claude-code");
</script>

<div class="pull" role="status" data-chrome>
  <span class="dot" aria-hidden="true"></span>
  <span class="txt"><Rich text={t("review.pull.text", { agent, n: round })} /></span>
  {#if pending > 0}<span class="k">{t("review.pull.pending", { k: pending })}</span>{/if}
  <button type="button" class="btn btn-pri btn-s" onclick={onfinish}>{t("review.pull.send")}<kbd>⇧F</kbd></button>
</div>

<style>
  .pull {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 8px 0 14px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    box-shadow: var(--shadow-soft);
    font-size: var(--fs-label);
    color: var(--text);
    white-space: nowrap;
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c-run);
    box-shadow: 0 0 0 3px var(--c-run-bg);
    animation: pulse var(--dur-pulse) ease-in-out infinite;
    flex: none;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  .txt {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .k {
    color: var(--muted);
  }
  .pull kbd {
    margin-left: 6px;
    background: none;
    color: inherit;
    border-color: color-mix(in srgb, var(--paper) 35%, transparent);
  }
</style>
