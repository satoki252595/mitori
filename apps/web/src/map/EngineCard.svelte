<!--
  Engine state card (ux.md R1 §2.2, UXP-15, AC-U-EN): when the generation engine is not installed, not logged in
  or lost a capability, the estimate card's start button is replaced by this card — the UI never sends a request
  that would come back 424. The session path (`/mitori:gen`) is always offered.
-->
<script lang="ts">
import type { EngineStatus } from "@mitori/core";
import { t } from "../shell/index.ts";
import type { EngineProblem } from "./engine.ts";

let {
  status,
  problem,
  effort,
  oncopy,
  onrecheck,
}: { status: EngineStatus; problem: EngineProblem; effort: string; oncopy: (s: string) => void; onrecheck: () => void } = $props();

const fix = $derived(problem === "notInstalled" ? "npm install -g @anthropic-ai/claude-code" : problem === "notLoggedIn" ? "claude login" : "claude update");
</script>

<section class="eng card" aria-labelledby="eng-t" data-testid="engine-card" data-problem={problem} data-chrome>
  <h2 id="eng-t">{t("gen.card.title")}</h2>
  <p class="state"><span class="mono">{status.engine}</span> &middot; {t(`engine.${problem}.title`)}</p>
  <p class="body">{t(`engine.${problem}.body`, { version: status.version ?? "–" })}</p>
  <div class="acts">
    <button type="button" class="btn btn-sec btn-s" onclick={() => oncopy(fix)}><code>{fix}</code></button>
    <button type="button" class="btn btn-gh btn-s" onclick={onrecheck}>{t("engine.recheck")}</button>
  </div>
  <div class="alt">
    <p>{t("engine.altSession")}</p>
    <button type="button" class="btn btn-pri btn-s" onclick={() => oncopy(`/mitori:gen ${effort}`)}>{t("gen.card.copySession")}</button>
  </div>
</section>

<style>
  .eng {
    padding: 18px 20px 14px;
    min-height: 352px;
    box-shadow: var(--shadow-soft);
  }
  h2 {
    font-family: var(--font-serif);
    font-size: var(--fs-lead);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 12px;
  }
  .state {
    margin: 0 0 6px;
    font-weight: var(--fw-strong);
    color: var(--c-warn);
    font-size: var(--fs-ui-m);
  }
  .body {
    margin: 0 0 12px;
    color: var(--text);
    font-size: var(--fs-ui);
    line-height: 1.7;
  }
  .acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .alt {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .alt p {
    margin: 0 0 8px;
  }
</style>
