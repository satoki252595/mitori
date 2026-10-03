<!--
  S1 見取り図 (ux.md §4.2 + R1 §2.2): strip · stage (ELK container diagram in the MVP, same FloorPlan component)
  · right column (room card / estimate card or progress / engine card / 「0 tok で今できること」 / static facts /
  stage times / README). Everything here is 0 tok; the three estimates are fetched after `mitori:map:painted`.
-->
<script lang="ts">
import { type Effort, type EngineId, type ExistingDocFact, HREFS, type SectionId } from "@mitori/core";
import { onMount, untrack } from "svelte";
import type { ZoomStage } from "../contract.ts";
import { defaultEffort, isRange } from "../gen/estimate.ts";
import GenEstimateCard from "../gen/GenEstimateCard.svelte";
import GenProgress from "../gen/GenProgress.svelte";
import { isActive, roomTargets } from "../gen/progress.ts";
import { copyText } from "../shell/clipboard.ts";
import { fmtInt, fmtLocShort, fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { errorText, t } from "../shell/index.ts";
import { mark } from "../shell/perf.ts";
import Rail from "../shell/Rail.svelte";
import { currentLayout, useStores } from "../stores/app.svelte.ts";
import EngineCard from "./EngineCard.svelte";
import { engineProblem } from "./engine.ts";
import FloorPlan from "./FloorPlan.svelte";
import type { PlanController } from "./plan-dom.ts";
import RoomCard from "./RoomCard.svelte";
import { buildPlanModel, type PlanText, type RoomModel } from "./render.ts";
import TextViewDialog from "./TextViewDialog.svelte";

const s = useStores();
const route = $derived(s.router.route);
const ws = $derived(route.name === "map" ? route.ws : null);
const st = $derived(s.workspace.status);
const scan = $derived(st?.scan.summary ?? null);
const view = $derived(s.map.view);
const model = $derived(view ? buildPlanModel(view) : null);
const layout = $derived(currentLayout(s));
const lang = $derived(s.prefs.lang);
let controller = $state.raw<PlanController | null>(null);
let hover = $state.raw<{ room: RoomModel; rect: DOMRect } | null>(null);
let readme = $state<string | null>(null);
let estimatesRequested = false;
let breakdown = $state(false);
let cardExpanded = $state(false);
let tail = $state<string | null>(null);

const engineStatus = $derived(s.session.engine(st?.genEngine ?? "claude-cli"));
const problem = $derived(engineProblem(engineStatus));
const run = $derived(s.gen.run);
const active = $derived(isActive(run));
const generated = $derived(!!s.doc.outline?.manifest.generatedAt);
// the right column waits for the outline (generated or not decides its first card) so nothing below moves
// when it resolves; bounded so a slow outline never hides the estimate for long (CLS 0, AC-U03)
let rightTimedOut = $state(false);
$effect(() => {
  const h = setTimeout(() => (rightTimedOut = true), 1200);
  return () => clearTimeout(h);
});
const rightReady = $derived(rightTimedOut || s.doc.outline !== null || s.doc.outlineError);
const policyAcked = $derived(!!s.session.settings?.settings.privacy.dataPolicyAck[s.gen.engine]);
const estimates = $derived.by(() => {
  const out: Partial<Record<Effort, ReturnType<typeof s.gen.current>>> = {};
  for (const e of ["overview", "standard", "complete"] as const) out[e] = s.gen.estimates.get(s.gen.key(e));
  return out as Partial<Record<Effort, NonNullable<ReturnType<typeof s.gen.current>>>>;
});
const targets = $derived(roomTargets(s.gen.tasks));
const nodeOfModule = $derived(new Map((model?.rooms ?? []).filter((r) => r.module).map((r) => [r.module as string, r.id])));
const genRooms = $derived(new Set([...targets.generating].map((m) => nodeOfModule.get(m) ?? m)));
const doneRooms = $derived(new Set([...targets.done].map((m) => nodeOfModule.get(m) ?? m)));
const pins = $derived(s.review.pinsByNode());
const selected = $derived(s.map.selected ? (model?.byId.get(s.map.selected) ?? null) : null);

const text: PlanText = {
  title: t("map.aria.plan"),
  roomLabel: (r) => t("map.aria.room", { zone: r.zoneLabel, room: r.label, files: r.files, n: r.threads }),
  roomHref: (r) => (ws ? HREFS.map(ws, r.id as `md_${string}`) : "#"),
};

// ---------------------------------------------------------------- data
$effect(() => {
  if (!ws) return;
  untrack(() => {
    void s.map.load();
    void s.api
      .call("GET /ws/:ws/facts", { params: { ws }, query: { kind: "existing_doc" } })
      .then((facts) => {
        const r = (facts as ExistingDocFact[]).find((f) => f.role === "readme");
        readme = r?.title ?? null;
      })
      .catch(() => {});
  });
});

// three estimates in parallel AFTER the map painted (fetch 0 when switching effort)
function onPainted() {
  if (estimatesRequested || generated) return;
  estimatesRequested = true;
  void s.gen.loadEstimates();
}

$effect(() => {
  if (controller) untrack(onPainted);
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
  tail = last ? `${t(`gen.stage.${last.stage}`)} · ${last.target.id}` : null;
});

// the room in the URL (`?room=`) is selected on load
$effect(() => {
  if (route.name === "map" && route.room && model?.byId.has(route.room)) untrack(() => (s.map.selected = route.room ?? null));
});

// ---------------------------------------------------------------- interactions
function select(id: string | null) {
  s.map.selected = id;
  if (ws && route.name === "map") s.router.replaceUrl(id ? { ...route, room: id } : { name: "map", ws, ...(route.zoom ? { zoom: route.zoom } : {}) });
  if (id) s.layers.open("selection", "room-sel", () => select(null));
  else s.layers.drop("room-sel");
  cardExpanded = false;
}

function sectionOf(r: RoomModel): SectionId | null {
  if (r.section) return r.section;
  const ix = s.doc.index;
  if (!ix || !r.module) return null;
  for (const n of ix.nodes.values()) if (n.module === r.module) return n.id;
  return null;
}

function open(id: string) {
  const r = model?.byId.get(id);
  if (!r || !ws) return;
  const sec = sectionOf(r) ?? "s5";
  void s.router.go({ name: "doc", ws, section: sec });
}

/** Zoomed in beyond the default stage: Escape (after the selection) steps one stage out (LAYER_ORDER `zoom`). */
function onZoom(k: number) {
  if (k > 1.02) {
    if (!s.layers.isOpen("map-zoom")) s.layers.open("zoom", "map-zoom", () => controller?.zoomOutOne());
  } else s.layers.drop("map-zoom");
}

function onStage(z: ZoomStage) {
  s.map.stage = z;
  if (z === "Z0" || z === "Z1") return;
}

function genEstimateFor(r: RoomModel): number | null {
  const sec = sectionOf(r);
  const n = sec ? s.doc.index?.nodes.get(sec) : undefined;
  if (!n || n.state === "generated" || n.state === "static_only") return null;
  return n.est ? n.est.inTokens + n.est.outTokens : null;
}

async function prioritize(r: RoomModel) {
  const sec = sectionOf(r);
  if (!sec) return;
  if (active) {
    if (await s.gen.prioritize(sec))
      s.bottom.toast({ id: "gen.prioritized", kind: "info", key: "toast.gen.prioritized", params: { id: s.doc.index?.numbers.get(sec) ?? sec } });
  } else await s.gen.estimateSection(sec);
}

async function start(opts: { notBefore?: string }) {
  const r = await s.gen.start(opts);
  if (r === "refreshed") s.bottom.toast({ id: "gen.refreshed", kind: "warn", key: "toast.gen.refreshed" });
  if (r === "started") {
    s.ui.announce(t("gen.announce.started"));
    s.prefs.setEffort(s.gen.effort);
  }
}

function ack(shownAt: string) {
  const engine = s.gen.engine;
  const plan = engineStatus?.plan ?? "unknown";
  const at = new Date().toISOString();
  void s.prefs.patchNow({ privacy: { dataPolicyAck: { [engine]: { at, shownAt, plan } } } }).then(() => s.session.loadSettings());
}

function setEffort(e: Effort) {
  s.gen.setEffort(e);
  mark("mitori:estimate:updated");
}

// ---------------------------------------------------------------- map keys (scope: map)
onMount(() => {
  const k = s.keys;
  const offs = [
    k.on("map.zoomIn", () => controller?.stepZoom(1)),
    k.on("map.zoomOut", () => controller?.stepZoom(-1)),
    k.on("map.fit", () => controller?.fit()),
    k.on("map.pan", (e) => {
      if (!controller) return;
      const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      if (controller.focusNeighbour(dir)) return;
      const step = e.shiftKey ? 192 : 48;
      if (e.key === "ArrowLeft") controller.panBy(step, 0);
      else if (e.key === "ArrowRight") controller.panBy(-step, 0);
      else if (e.key === "ArrowUp") controller.panBy(0, step);
      else controller.panBy(0, -step);
    }),
  ];
  return () => {
    for (const off of offs) off();
    s.layers.drop("room-sel");
    s.layers.drop("map-zoom");
  };
});

const ZOOMS: ZoomStage[] = ["Z0", "Z1", "Z2"];
const facts = $derived.by(() => {
  const f = scan?.facts ?? {};
  return [
    { kind: "entry", n: f.entry ?? 0, sec: "s4" },
    { kind: "route", n: f.route ?? 0, sec: "s8" },
    { kind: "env", n: f.env ?? 0, sec: "s8" },
    { kind: "cli", n: f.cli ?? 0, sec: "s8" },
    { kind: "test", n: f.test ?? 0, sec: "s4" },
    { kind: "todo", n: f.todo ?? 0, sec: "s11" },
  ] as const;
});
const lang0 = $derived(scan?.languages[0]?.lang ?? null);
const stale = $derived(s.doc.outline?.counts.stale ?? 0);
</script>

<div class="body map-body" style:grid-template-columns="{layout.rail}px minmax(0,1fr) {layout.mapRight}px">
  <Rail mode={layout.railMode} />

  <main id="main" class="map-main" tabindex="-1" aria-labelledby="map-title">
    <section class="strip" data-chrome>
      <p class="kicker">
        <span class="dot" aria-hidden="true"></span>
        {#if generated && s.doc.outline}
          {t("map.strip.generated", {
            tok: fmtTokensImpl(s.doc.outline.manifest.usageTotals.in + s.doc.outline.manifest.usageTotals.cacheRead + s.doc.outline.manifest.usageTotals.cacheWrite + s.doc.outline.manifest.usageTotals.out),
            usd: fmtUsdImpl(s.doc.outline.manifest.usageTotals.apiUsd, "gen"),
          })}
        {:else if scan}
          {t("map.strip.scanned", { files: fmtInt(scan.files, lang), s: (scan.ms / 1000).toFixed(2) })}<b>{t("map.strip.zeroTok")}</b>
        {:else if s.workspace.scan}
          {t("map.strip.scanning", { stage: s.workspace.scan.stage, done: fmtInt(s.workspace.scan.done, lang), total: fmtInt(s.workspace.scan.total, lang) })}
        {:else}
          <span class="skel kick-skel">&nbsp;</span>
        {/if}
      </p>
      <div class="head">
        <h1 id="map-title" class="title"><span data-user-content>{st?.info.name ?? " "}</span></h1>
        <p class="meta mono">
          {#if lang0}<span>{lang0}</span><span aria-hidden="true">&middot;</span>{/if}
          {#if scan}<span>{fmtLocShort(scan.loc)} LOC</span><span aria-hidden="true">&middot;</span><span>{t("map.strip.files", { n: fmtInt(scan.files, lang) })}</span>{/if}
          {#if s.workspace.head7}<span aria-hidden="true">&middot;</span><span>{s.workspace.head7}</span>{/if}
          {#if s.map.fallback}<span class="fb">{t("map.strip.fallback")}</span>{/if}
        </p>
      </div>
    </section>

    <section class="stage" aria-label={t("map.stage")}>
      {#if view && model}
        <FloorPlan
          {view}
          {text}
          selected={s.map.selected}
          overlays={s.map.overlays}
          generating={genRooms}
          done={doneRooms}
          {pins}
          onselect={select}
          onopen={open}
          onstage={onStage}
          onzoom={onZoom}
          onhover={(id, rect) => (hover = id && rect && model ? { room: model.byId.get(id) as RoomModel, rect } : null)}
          bind:controller
        />
        <p id="plan-desc" class="sr-only">{t("map.text.summary", { zones: model.zones.length, rooms: model.rooms.length, edges: model.edges.length })}</p>
      {:else if s.map.error}
        <div class="err-card center" role="alert">
          <h2>{t("map.error")}</h2>
          <p>{errorText(s.map.error)}</p>
          <button type="button" class="btn btn-sec btn-s" onclick={() => s.workspace.rescan()}>{t("map.rescan")}</button>
        </div>
      {:else}
        <div class="stage-skel" aria-busy="true"><span>{t("app.loading")}</span></div>
      {/if}

      <div class="hud" data-chrome>
        <button type="button" class="chip" aria-pressed={s.map.overlays.comments} onclick={() => (s.map.overlays.comments = !s.map.overlays.comments)}>{t("map.hud.comments")}</button>
        <button type="button" class="chip" aria-pressed={s.map.overlays.working} onclick={() => (s.map.overlays.working = !s.map.overlays.working)}>{t("map.hud.working")}</button>
        <details class="menu">
          <summary class="chip">{t("map.hud.view")}</summary>
          <div class="pop menu-pop" role="menu">
            <label><input type="checkbox" bind:checked={s.map.overlays.freshness} /> {t("map.hud.freshness")}</label>
            <label><input type="checkbox" bind:checked={s.map.overlays.allDeps} /> {t("map.hud.allDeps")}</label>
            <button type="button" role="menuitem" onclick={() => (s.ui.textViewOpen = true)}>{t("map.hud.textView")}</button>
          </div>
        </details>
      </div>

      <div class="zoombar" role="group" aria-label={t("map.zoom.label")} data-chrome>
        <div class="seg" role="group" aria-label={t("map.zoom.stages")}>
          {#each ZOOMS as z (z)}
            <button type="button" aria-pressed={s.map.stage === z} onclick={() => controller?.zoomToStage(z)}>{t(`map.zoom.${z}`)}</button>
          {/each}
        </div>
        <button type="button" class="icon-btn" aria-label={t("map.zoom.out")} onclick={() => controller?.stepZoom(-1)}>&minus;</button>
        <button type="button" class="icon-btn" aria-label={t("map.zoom.in")} onclick={() => controller?.stepZoom(1)}>+</button>
        <button type="button" class="icon-btn" aria-label={t("map.zoom.fit")} onclick={() => controller?.fit()}>&#x2922;</button>
      </div>

      {#if hover?.room}
        <div class="pop l0" role="tooltip" style:left="{Math.max(8, hover.rect.left)}px" style:top="{hover.rect.bottom + 6}px" data-chrome>
          <b data-user-content>{hover.room.label}</b>
          <span class="mono">{t("map.room.static", { files: hover.room.files, loc: fmtLocShort(hover.room.loc) })}</span>
          {#if hover.room.topSymbols.length}<span class="mono" data-user-content>{hover.room.topSymbols.join(" · ")}</span>{/if}
        </div>
      {/if}
    </section>
  </main>

  <aside class="map-right" aria-label={t("map.right")} aria-busy={!rightReady || undefined}>
  {#if rightReady}
    {#if selected}
      {@const sec = sectionOf(selected)}
      <RoomCard
        title={selected.zoneLabel ? `${selected.zoneLabel} › ${selected.label}` : selected.label}
        summary={t("map.room.static", { files: selected.files, loc: fmtLocShort(selected.loc) }) + (selected.topSymbols.length ? ` · ${selected.topSymbols.join(", ")}` : "")}
        freshness={selected.fresh}
        threads={selected.threads}
        section={sec}
        sectionLabel={sec ? (s.doc.index?.numbers.get(sec) ?? "") : ""}
        genTokens={genEstimateFor(selected)}
        onread={() => open(selected.id)}
        ongenerate={() => prioritize(selected)}
      />
    {/if}

    {#if active && run}
      <GenProgress {run} tasks={s.gen.tasks} {tail} oncontrol={(a) => s.gen.control(a)} />
    {:else if generated && !s.gen.estimates.size}
      <section class="done card" data-chrome>
        <p>
          {t("map.generated", { tok: fmtTokensImpl(s.doc.outline?.manifest.usageTotals.out ?? 0), usd: fmtUsdImpl(s.doc.outline?.manifest.usageTotals.apiUsd ?? 0, "gen") })}
          {#if stale > 0}<span class="stale">{t("map.staleChapters", { n: stale })}</span>{/if}
        </p>
        {#if ws}<a class="btn btn-sec btn-s" href={HREFS.doc(ws, "s0")}>{t("map.read")}</a>{/if}
      </section>
    {:else if problem && engineStatus}
      <EngineCard status={engineStatus} {problem} effort={s.gen.effort} oncopy={(c) => copyText(c, s, "copy.command")} onrecheck={() => s.session.loadEngines()} />
    {:else}
      <GenEstimateCard
        {estimates}
        effort={s.gen.effort}
        engine={s.gen.engine}
        window={s.session.window ?? engineStatus?.window ?? null}
        {policyAcked}
        breakdownOpen={breakdown || s.doc.level === "expert"}
        {engineStatus}
        {scan}
        busy={s.gen.starting}
        collapsed={!!selected && !cardExpanded}
        oneffort={setEffort}
        onengine={(e: EngineId) => void s.gen.setEngine(e)}
        onstart={start}
        onack={ack}
        oncopy={(c) => copyText(c, s, "copy.command")}
        onexpand={() => (cardExpanded = true)}
      />
    {/if}
    {#if s.gen.error}<p class="gen-err" role="alert">{errorText(s.gen.error)}</p>{/if}

    {#if !generated}
      <section class="zero" aria-labelledby="zero-t" data-chrome>
        <h2 id="zero-t" class="rail-label">{t("map.zero.title")}</h2>
        <ul>
          <li><button type="button" class="link-btn" onclick={() => (document.querySelector(".room") as HTMLElement | null)?.focus()}>{t("map.zero.walk")}</button></li>
          <li>
            {t("map.zero.static")}
            {#if ws}
              {#each ["s4", "s5", "s8", "s11"] as sec (sec)}<a class="link" href={HREFS.doc(ws, sec as SectionId)}>&sect;{sec.slice(1)}</a>{" "}{/each}
            {/if}
          </li>
          <li><button type="button" class="link-btn" onclick={() => (breakdown = true)}>{t("map.zero.estimate")}</button></li>
        </ul>
      </section>
    {/if}

    <section class="facts" aria-labelledby="facts-t" data-chrome>
      <h2 id="facts-t" class="rail-label">{t("map.facts.title")}</h2>
      <div class="grid">
        {#each facts as f (f.kind)}
          <a class="fact card" href={ws ? HREFS.doc(ws, f.sec) : "#"}><span class="n mono">{scan ? fmtInt(f.n, lang) : "–"}</span><span class="l">{t(`map.facts.${f.kind}`)}</span></a>
        {/each}
      </div>
    </section>

    <section class="times" aria-labelledby="times-t" data-chrome>
      <h2 id="times-t" class="rail-label">{t("map.times.title")}</h2>
      <ul class="mono">
        {#each ["S0", "S1", "S2", "S3", "S4"] as stg (stg)}
          <li><span>{t(`map.times.${stg}`)}</span><span>{scan?.stageMs?.[stg as "S0"] !== undefined ? `${Math.round(scan?.stageMs?.[stg as "S0"] ?? 0)} ms` : "–"}</span></li>
        {/each}
      </ul>
    </section>

    {#if readme}
      <section class="readme" data-chrome>
        <blockquote data-user-content>{readme}</blockquote>
        <p class="note">{t("map.readme.note")}</p>
      </section>
    {/if}
  {/if}
  </aside>
</div>

{#if s.ui.textViewOpen && model}<TextViewDialog {model} onclose={() => (s.ui.textViewOpen = false)} />{/if}

<style>
  .map-body {
    height: calc(100vh - var(--hdr));
    min-height: 0;
  }
  .map-main {
    display: flex;
    flex-direction: column;
    height: calc(100vh - var(--hdr) - var(--status));
    min-width: 0;
  }
  .strip {
    flex: none;
    height: var(--map-strip);
    padding: 12px 28px 0;
    overflow: hidden;
  }
  .kicker {
    display: flex;
    align-items: center;
    height: 22px;
    gap: 8px;
    font-size: var(--fs-ui-s);
    color: var(--muted);
    margin: 0 0 4px;
    white-space: nowrap;
    overflow: hidden;
  }
  .kicker b {
    color: var(--ink);
    font-weight: var(--fw-strong);
    margin-left: 4px;
  }
  .kick-skel {
    width: 26em;
    height: 1.2em;
  }
  /* title + meta on one line at every width: the meta truncates instead of wrapping (no shift when it fills in) */
  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    min-width: 0;
    white-space: nowrap;
  }
  .title {
    font-family: var(--font-serif);
    font-size: var(--fs-h1);
    line-height: 1.1;
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0;
    letter-spacing: -0.005em;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    display: flex;
    flex: 1 1 0;
    gap: 6px;
    min-width: 0;
    margin: 0;
    font-size: var(--fs-label);
    color: var(--muted);
    overflow: hidden;
  }
  .fb {
    color: var(--c-warn);
    margin-left: 10px;
    font-family: var(--font-ui);
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: 0 20px 14px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background-color: var(--paper);
    background-image: radial-gradient(circle at 1px 1px, var(--rule) 1px, transparent 1.2px);
    background-size: 16px 16px;
    overflow: hidden;
  }
  .stage-skel {
    position: absolute;
    inset: 24px;
    border-radius: var(--r-card);
    background: var(--paper-2);
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .center {
    position: absolute;
    left: 50%;
    top: 40%;
    transform: translate(-50%, -50%);
  }
  .hud {
    position: absolute;
    left: 12px;
    top: 12px;
    display: flex;
    gap: 6px;
    z-index: 2;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: var(--r-btn);
    background: var(--sheet);
    color: var(--muted);
    font-size: var(--fs-label);
    cursor: pointer;
    list-style: none;
  }
  .chip[aria-pressed="true"] {
    color: var(--ink);
    border-color: var(--rule-2);
  }
  .chip[aria-pressed="true"]::before {
    content: "\2713";
    color: var(--c-ok);
  }
  .menu {
    position: relative;
  }
  .menu summary::-webkit-details-marker {
    display: none;
  }
  .menu-pop {
    position: absolute;
    top: 34px;
    left: 0;
    width: 220px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-ui);
  }
  .menu-pop label,
  .menu-pop button {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 28px;
    padding: 2px 6px;
    border-radius: var(--r-btn);
    text-align: left;
  }
  .menu-pop label:hover,
  .menu-pop button:hover {
    background: var(--hover);
  }
  .zoombar {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 4px;
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    background: var(--sheet);
    box-shadow: var(--shadow-soft);
    z-index: 2;
  }
  .zoombar .seg {
    height: 28px;
  }
  .zoombar .icon-btn {
    width: 28px;
    height: 28px;
    font-size: var(--fs-ui-l);
  }
  .l0 {
    position: fixed;
    max-width: 280px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-ui-s);
    pointer-events: none;
  }
  .l0 b {
    color: var(--ink);
  }
  .l0 .mono {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .map-right {
    height: calc(100vh - var(--hdr) - var(--status));
    overflow: auto;
    padding: 16px 20px 24px 4px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    scrollbar-width: thin;
    min-width: 0;
  }
  .map-right > :global(*) {
    flex: none;
  }
  .done {
    padding: 14px 16px;
    font-size: var(--fs-ui);
  }
  .done p {
    margin: 0 0 8px;
  }
  .stale {
    color: var(--c-warn);
    margin-left: 6px;
  }
  .gen-err {
    color: var(--c-bad);
    margin: -8px 0 0;
    font-size: var(--fs-label);
  }
  .zero ul,
  .times ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .zero li {
    font-size: var(--fs-ui);
    color: var(--text);
    padding: 4px 8px;
    line-height: 1.7;
  }
  .zero .link {
    margin-right: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .link-btn {
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
    text-underline-offset: 3px;
    text-align: left;
    min-height: 24px;
  }
  .facts .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .fact {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    height: 62px;
  }
  .fact:hover {
    border-color: var(--rule-2);
  }
  .fact .n {
    font-size: var(--fs-lead);
    color: var(--ink);
  }
  .fact .l {
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .times li {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-label);
    color: var(--muted);
    padding: 2px 8px;
  }
  /* fixed value box: "–" → "12 ms" never moves the text (right-aligned inside) */
  .times li span:last-child {
    min-width: 8ch;
    text-align: right;
  }
  .readme blockquote {
    margin: 0;
    padding: 2px 0 2px 16px;
    border-left: 2px solid var(--rule-2);
    font-family: var(--font-serif);
    font-style: italic;
    font-size: var(--fs-body);
    line-height: 1.6;
    color: var(--text);
  }
  .readme .note {
    font-size: var(--fs-meta);
    color: var(--faint);
    margin: 6px 0 0 18px;
  }
  @media (max-width: 1023px) {
    .map-body {
      grid-template-columns: minmax(0, 1fr) !important;
      height: auto;
    }
    .map-main {
      height: 70vh;
    }
    .map-right {
      height: auto;
      padding: 16px;
    }
  }
</style>
