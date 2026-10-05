<script lang="ts">
import { type Effort, type EngineId } from "@mitori/core";
import { untrack } from "svelte";
import { defaultEffort, isRange } from "../gen/estimate.ts";
import GenEstimateCard from "../gen/GenEstimateCard.svelte";
import GenProgress from "../gen/GenProgress.svelte";
import { isActive } from "../gen/state.ts";
import { copyText } from "../shell/clipboard.ts";
import { fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { hasKey } from "../shell/i18n.ts";
import { errorText, t } from "../shell/index.ts";
import { mark } from "../shell/perf.ts";
import { useStores } from "../stores/app.svelte.ts";
import EngineCard from "./EngineCard.svelte";
import { engineProblem, policyAcknowledged } from "./engine.ts";
import { generatedTokens } from "./hero.ts";

let {
  breakdown,
  fiveName,
  onread,
  initialClock = null,
  effortOverride = null,
}: {
  breakdown: boolean;
  fiveName: string;
  onread: () => void;
  initialClock?: import("../gen/visibility.ts").VisibleClock | null;
  effortOverride?: Effort | null;
} = $props();
const s = useStores();
const effort = $derived(effortOverride ?? s.gen.effort);
const ws = $derived(s.workspace.key);
const scan = $derived(s.workspace.status?.scan.summary ?? null);
const generated = $derived(!!s.doc.outline?.manifest.generatedAt);
const totals = $derived(s.doc.outline?.manifest.usageTotals ?? null);
const stale = $derived(s.doc.outline?.counts.stale ?? 0);
const run = $derived(s.gen.run);
const active = $derived(isActive(run));
let tail = $state<string | null>(null);
const engineStatus = $derived(s.session.engine(s.gen.engine));
const enginesLoaded = $derived(s.session.engines !== null);
const problem = $derived(engineProblem(engineStatus));
const policyAcked = $derived(policyAcknowledged(s.gen.engine, engineStatus, s.session.settings?.settings.privacy.dataPolicyAck[s.gen.engine]));
const estimates = $derived.by(() => {
  const out: Partial<Record<Effort, ReturnType<typeof s.gen.current>>> = {};
  for (const e of ["overview", "standard", "complete"] as const) out[e] = s.gen.estimates.get(s.gen.key(e));
  return out as Partial<Record<Effort, NonNullable<ReturnType<typeof s.gen.current>>>>;
});

// default effort (cookie → uncalibrated pro ⇒ overview → workspace → global), until the user picks one
$effect(() => {
  const std = estimates.standard;
  if (!std || s.gen.effortChosen) return;
  const settings = s.session.settings?.settings;
  const uncalPro = engineStatus?.plan === "pro" && (!!std.windowDeltaRange || isRange(std));
  const e = defaultEffort({
    cookie: s.prefs.effort ?? undefined,
    workspace: ws ? settings?.workspaces[ws]?.defaultEffort : undefined,
    global: settings?.defaultEffort,
    uncalibratedPro: uncalPro,
  });
  untrack(() => s.gen.setEffort(e, false));
});

// tail line = the latest running task
$effect(() => {
  const running = s.gen.tasks.filter((x) => x.state === "running");
  const last = running[running.length - 1];
  // gen strings arrive with the side chunk (i18n-ns.ts `gen`): until then the tail is the task id alone
  tail = last ? (hasKey(`gen.stage.${last.stage}`) ? `${t(`gen.stage.${last.stage}`)} · ${last.target.id}` : last.target.id) : null;
});

async function start(opts: { notBefore?: string }) {
  const r = await s.gen.start(opts);
  if (r === "refreshed") s.bottom.toast({ id: "gen.refreshed", kind: "warn", key: "toast.gen.refreshed" });
  if (r === "started") {
    s.ui.announce(t("gen.announce.started"));
    s.prefs.setEffort(s.gen.effort);
  }
}

function ack(shownAt: string): Promise<unknown> {
  const engine = s.gen.engine;
  const plan = engineStatus?.plan ?? "unknown";
  const at = new Date().toISOString();
  return s.prefs.patchNow({ privacy: { dataPolicyAck: { [engine]: { at, shownAt, plan } } } }).then(() => s.session.loadSettings());
}

function setEffort(e: Effort) {
  s.gen.setEffort(e);
  mark("mitori:estimate:updated");
}
</script>
          {#if active && run}
            <GenProgress {run} tasks={s.gen.tasks} {tail} oncontrol={(a) => s.gen.control(a)} />
          {:else if generated && !s.gen.estimates.size && totals}
            <section class="done card" aria-labelledby="done-t" data-chrome>
              <h2 id="done-t">{t("gen.card.doneTitle")}</h2>
              <div class="done-main">
                <p>
                  <b>{t("map.generated", generatedTokens(totals, fmtTokensImpl, (u) => fmtUsdImpl(u, "gen")))}</b>
                  {#if stale > 0}<span class="stale">{t("map.staleChapters", { n: stale })}</span>{/if}
                </p>
                {#if ws}<button type="button" class="btn btn-pri" onclick={onread}>{t("map.read5", { name: fiveName })}</button>{/if}
              </div>
            </section>
          {:else if problem && engineStatus}
            <EngineCard status={engineStatus} {problem} {effort} oncopy={(c) => copyText(c, s, "copy.command")} onrecheck={() => s.session.loadEngines()} />
          {:else}
            <GenEstimateCard
              {estimates}
              {initialClock}
              {effort}
              engine={s.gen.engine}
              reasoning={s.session.settings?.settings.reasoning[effort === "overview" ? "genOverview" : "gen"]}
              window={s.session.window ?? engineStatus?.window ?? null}
              {policyAcked}
              breakdownOpen={breakdown || s.doc.level === "expert"}
              {engineStatus}
              detecting={!enginesLoaded}
              {scan}
              busy={s.gen.starting}
              oneffort={setEffort}
              onengine={(e: EngineId) => void s.gen.setEngine(e)}
              onstart={start}
              onack={ack}
              oncopy={(c) => copyText(c, s, "copy.command")}
              onsettings={() => ws && void s.router.go({ name: "wsSettings", ws })}
            />
          {/if}
          {#if s.gen.error}<p class="gen-err" role="alert">{errorText(s.gen.error)}</p>{/if}

<style>
  .done {
    padding: 18px 20px 16px;
    box-shadow: var(--shadow-soft);
  }
  .done h2 {
    font-family: var(--font-serif);
    font-size: var(--fs-lead);
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0 0 12px;
  }
  .done-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--fs-ui);
  }
  .done-main p {
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  .stale {
    color: var(--c-warn);
    font-size: var(--fs-label);
  }
  .gen-err {
    color: var(--c-bad);
    margin: 0;
    font-size: var(--fs-label);
  }
  /* ---------------------------------------------------------------- ② plan */

</style>
