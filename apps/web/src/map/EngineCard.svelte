<!--
  Engine state card (ux.md R1 §2.2, UXP-15, AC-U-EN): when the generation engine is not installed, not logged in
  or lost a capability, the estimate card's start button is replaced by this card — the UI never sends a request
  that would come back 424. It lists the exact steps that fix the state (each command copyable), re-probes on
  request, and always offers provider-neutral session instructions.
-->
<script lang="ts">
import type { Effort, EngineStatus } from "@mitori/core";
import { sessionMode } from "../gen/estimate.ts";
import type { LauncherCommand } from "../settings/provider.ts";
import { providerSetupCommand } from "../settings/provider.ts";
import { t } from "../shell/index.ts";
import { type EngineProblem, fixSteps, museUpdated } from "./engine.ts";

let {
  status,
  problem,
  effort,
  oncopy,
  onrecheck,
  repo,
  launcher,
}: {
  status: EngineStatus;
  problem: EngineProblem;
  effort: Effort;
  oncopy: (s: string) => void;
  onrecheck: () => void | Promise<void>;
  repo?: string | undefined;
  launcher?: LauncherCommand | undefined;
} = $props();

const steps = $derived(fixSteps(problem, status.engine, museUpdated(status) ? { museSetup: providerSetupCommand({ provider: "muse" }, launcher) } : {}));
const session = $derived(sessionMode(effort, { repo, launcher }));
let checking = $state(false);
async function recheck() {
  checking = true;
  try {
    await onrecheck();
  } finally {
    checking = false;
  }
}
</script>

<section class="eng card" aria-labelledby="eng-t" data-testid="engine-card" data-problem={problem} data-chrome>
  <h2 id="eng-t">{t("gen.card.title")}</h2>
  <p class="state"><span class="w" aria-hidden="true">&#x26A0;&#xFE0E;</span><span class="mono">{status.engine}</span> &middot; {t(`engine.${problem}.title`)}</p>
  <p class="desc">{t(`engine.${problem}.body`, { version: status.version ?? "–", engine: status.engine })}</p>
  <ol class="steps">
    {#each steps as st, i (i)}
      <li>
        <span class="no mono" aria-hidden="true">{i + 1}</span>
        <span class="what">{t(`engine.step.${st.key}`)}</span>
        {#if st.cmd}
          <button type="button" class="cmd mono" title={t("engine.copy")} onclick={() => oncopy(st.cmd ?? "")}>{st.cmd}<span class="cp" aria-hidden="true">&#x2398;</span></button>
        {:else if st.key === "recheck"}
          <button type="button" class="btn btn-sec btn-s" aria-disabled={checking || undefined} onclick={recheck}>{checking ? t("engine.checking") : t("engine.recheck")}</button>
        {/if}
      </li>
    {/each}
  </ol>
  <p class="note">{t("engine.pathHint")}</p>
  <div class="alt">
    <p>{t("engine.altSession")}</p>
    <button type="button" class="cmd mono" onclick={() => oncopy(session.copy)}>{session.raw}<span class="cp" aria-hidden="true">&#x2398;</span></button>
  </div>
</section>

<style>
  .eng {
    padding: 22px 24px 16px;
    min-height: 352px;
    box-shadow: var(--shadow-soft);
  }
  h2 {
    font-family: var(--font-serif);
    font-size: 21px;
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 14px;
  }
  .state {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 0 0 6px;
    font-weight: var(--fw-strong);
    color: var(--c-warn);
    font-size: var(--fs-ui-m);
  }
  .desc {
    margin: 0 0 12px;
    color: var(--text);
    font-size: var(--fs-ui);
    line-height: 1.7;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--rule);
    border-radius: 9px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 4px 10px;
    align-items: center;
    padding: 10px 12px;
  }
  .steps li + li {
    border-top: 1px solid var(--rule-soft);
  }
  .no {
    grid-row: span 2;
    align-self: start;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: var(--fs-meta);
    color: var(--muted);
    border: 1px solid var(--rule-2);
  }
  .what {
    font-size: var(--fs-ui);
    color: var(--ink);
  }
  .steps .btn,
  .steps .cmd {
    justify-self: start;
  }
  .cmd {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 4px 8px;
    border: 1px solid var(--rule);
    border-radius: var(--r-btn);
    background: var(--code-bg, var(--paper-2));
    color: var(--text);
    font-size: var(--fs-label);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cmd:hover {
    border-color: var(--rule-2);
    color: var(--ink);
  }
  .cp {
    color: var(--muted);
  }
  .note {
    margin: 10px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.6;
  }
  .alt {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .alt p {
    margin: 0 0 8px;
  }
</style>
