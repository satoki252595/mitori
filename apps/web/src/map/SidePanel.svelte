<script lang="ts">
import { type Effort, type EngineId, type GenEstimate } from "@mitori/core";
import { untrack } from "svelte";
import { defaultEffort, EFFORTS, isRange } from "../gen/estimate.ts";
import GenEstimateCard from "../gen/GenEstimateCard.svelte";
import { isActive } from "../gen/state.ts";
import { copyText } from "../shell/clipboard.ts";
import { hasKey } from "../shell/i18n.ts";
import { errorText, t } from "../shell/index.ts";
import { mark } from "../shell/perf.ts";
import { useStores } from "../stores/app.svelte.ts";
import { engineProblem, policyAcknowledged } from "./engine.ts";

let {
  breakdown,
  fiveName,
  onread,
  initialClock = null,
  effortOverride = null,
  initialProgress = null,
  initialEngineCard = null,
  initialBreakdown = null,
  initialDoneCard = null,
}: {
  breakdown: boolean;
  fiveName: string;
  onread: () => void;
  initialClock?: import("../gen/visibility.ts").VisibleClock | null;
  effortOverride?: Effort | null;
  initialProgress?: typeof import("../gen/GenProgress.svelte").default | null | undefined;
  initialEngineCard?: typeof import("./EngineCard.svelte").default | null | undefined;
  initialBreakdown?: typeof import("../gen/GenBreakdown.svelte").default | null | undefined;
  initialDoneCard?: typeof import("../gen/GenDoneCard.svelte").default | null | undefined;
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
const engineStatus = $derived(s.session.engine(s.gen.engine));
const enginesLoaded = $derived(s.session.engines !== null);
const problem = $derived(engineProblem(engineStatus));
let GenProgress = $state.raw(untrack(() => initialProgress));
let EngineCard = $state.raw(untrack(() => initialEngineCard));
let GenDoneCard = $state.raw(untrack(() => initialDoneCard));
$effect(() => {
  if (active && !GenProgress) void import("../gen/GenProgress.svelte").then((m) => (GenProgress = m.default));
});
$effect(() => {
  if (problem && !EngineCard) void import("./EngineCard.svelte").then((m) => (EngineCard = m.default));
});
$effect(() => {
  if (generated && !s.gen.estimates.size && totals && !GenDoneCard) void import("../gen/GenDoneCard.svelte").then((m) => (GenDoneCard = m.default));
});
const policyAcked = $derived(policyAcknowledged(s.gen.engine, engineStatus, s.session.settings?.settings.privacy.dataPolicyAck[s.gen.engine]));
const estimates = $derived(Object.fromEntries(EFFORTS.map((e) => [e, s.gen.estimates.get(s.gen.key(e))])) as Partial<Record<Effort, GenEstimate>>);

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
const tail = $derived.by(() => {
  const last = s.gen.tasks.findLast((x) => x.state === "running");
  // gen strings arrive with the side chunk (i18n-ns.ts `gen`): until then the tail is the task id alone
  return last ? (hasKey(`gen.stage.${last.stage}`) ? `${t(`gen.stage.${last.stage}`)} · ${last.target.id}` : last.target.id) : null;
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
            {#if GenProgress}<GenProgress {run} tasks={s.gen.tasks} {tail} oncontrol={(a) => s.gen.control(a)} />{:else}<div class="card stage-skel" aria-busy="true">{t("app.loading")}</div>{/if}
          {:else if generated && !s.gen.estimates.size && totals}
            {#if GenDoneCard}<GenDoneCard {totals} {stale} {fiveName} onread={ws ? onread : undefined} />{:else}<div class="card stage-skel" aria-busy="true">{t("app.loading")}</div>{/if}
          {:else if problem && engineStatus}
            {#if EngineCard}<EngineCard status={engineStatus} {problem} {effort} repo={s.workspace.status?.info.root} launcher={s.session.settings?.launcher} oncopy={(c) => copyText(c, s, "copy.command")} onrecheck={() => s.session.loadEngines()} />{:else}<div class="card stage-skel" aria-busy="true">{t("app.loading")}</div>{/if}
          {:else}
            <GenEstimateCard
              {estimates}
              {initialClock}
              {initialBreakdown}
              repo={s.workspace.status?.info.root}
              launcher={s.session.settings?.launcher}
              {effort}
              engine={s.gen.engine}
              genericProtocol={s.session.settings?.settings.engines.generic.protocol ?? "text"}
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
              onsettings={() => {
                if (!ws) return;
                s.ui.focusEngines = true;
                void s.router.go({ name: "wsSettings", ws });
              }}
            />
          {/if}
          {#if s.gen.error}<p class="gen-err" role="alert">{errorText(s.gen.error)}</p>{/if}

<style>
  .gen-err {
    color: var(--c-bad);
    margin: 0;
    font-size: var(--fs-label);
  }
  /* ---------------------------------------------------------------- ② plan */

</style>
