<!--
  S1 見取り図 (ux.md §4.2 + R1 §2.2, prototype `01-first-run-map`): one scrolling page right of the rail —
  ① the hero (kicker · repository name · remote / toolchain / license / HEAD (date) · README excerpt with its
  source chip · LOC tiles, all from `WorkspaceStatus.profile`, CR m1-26) beside the generation card (estimate /
  engine card / progress / done), ② the plan (ELK-free container map: zones as bands, rooms sized for their
  labels; the selected room's card floats in the stage), ③ the 0-tok band (what you can do now · static facts ·
  stage times). Everything here is 0 tok; the three estimates are fetched after `mitori:map:painted`.
-->
<script lang="ts">
import { type AreaStat, type Effort, type EngineId, HREFS, type RepoPath, type SectionId, type SourceLang } from "@mitori/core";
import { onMount, untrack } from "svelte";
import type { ZoomStage } from "../contract.ts";
import { defaultEffort, isRange } from "../gen/estimate.ts";
import { isActive, roomTargets } from "../gen/progress.ts";
import { copyText } from "../shell/clipboard.ts";
import { fmtInt, fmtLocShort, fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { hasKey } from "../shell/i18n.ts";
import { ensureNs } from "../shell/i18n-cell.svelte.ts";
import { errorText, t } from "../shell/index.ts";
import { afterMark, mark, markAfterPaint } from "../shell/perf.ts";
import Rail from "../shell/Rail.svelte";
import { choosePath, courseName, NEWCOMER_PATH } from "../shell/reading.ts";
import { currentLayout, useStores } from "../stores/app.svelte.ts";
import { engineProblem } from "./engine.ts";
import FloorPlan from "./FloorPlan.svelte";
import { generatedTokens, heroAreas, heroMeta, LANG_NAMES, ledeOf, oneSentence } from "./hero.ts";
import type { PlanController } from "./plan-dom.ts";
import { buildPlanModel, type PlanText, type RoomModel } from "./render.ts";

const s = useStores();
// the card states, room card and text view arrive in the lazy `gen` chunk once the plan has painted (F5: not
// first-paint; the card column holds a same-size skeleton meanwhile)
let side = $state.raw<typeof import("./side.ts") | null>(null);
onMount(() => afterMark(["mitori:map:painted"], () => void Promise.all([import("./side.ts"), ensureNs("gen")]).then(([m]) => (side = m)), 800));
const route = $derived(s.router.route);
const ws = $derived(route.name === "map" ? route.ws : null);
const st = $derived(s.workspace.status);
const scan = $derived(st?.scan.summary ?? null);
const profile = $derived(st?.profile ?? null);
const view = $derived(s.map.view);
const model = $derived(view ? buildPlanModel(view) : null);
const layout = $derived(currentLayout(s));
const lang = $derived(s.prefs.lang);
let controller = $state.raw<PlanController | null>(null);
let hover = $state.raw<{ room: RoomModel; rect: DOMRect } | null>(null);
let estimatesRequested = false;
let breakdown = $state(false);
let tail = $state<string | null>(null);

const engineStatus = $derived(s.session.engine(st?.genEngine ?? "claude-cli"));
const enginesLoaded = $derived(s.session.engines !== null);
const problem = $derived(engineProblem(engineStatus));
const run = $derived(s.gen.run);
const active = $derived(isActive(run));
const generated = $derived(!!s.doc.outline?.manifest.generatedAt);
// the card column waits for the outline (generated or not decides its first card) so nothing below moves
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
// the floating room card takes the half of the stage the selected room is NOT in
let stageEl: HTMLDivElement | undefined = $state();
let cardLeft = $state(false);
$effect(() => {
  const id = s.map.selected;
  if (!id || !controller || !stageEl) return;
  const r = controller.roomRect(id);
  const st = stageEl.getBoundingClientRect();
  untrack(() => (cardLeft = !!r && r.left + r.width / 2 > st.left + st.width / 2));
});

const text: PlanText = {
  title: t("map.aria.plan"),
  roomLabel: (r) => t("map.aria.room", { zone: r.zoneLabel, room: r.label, files: r.files, n: r.threads }),
  roomHref: (r) => (ws ? HREFS.map(ws, r.id as `md_${string}`) : "#"),
  files: (n) => t("map.room.files", { n }),
};

// ---------------------------------------------------------------- hero (CR m1-26; absent profile ⇒ scan summary)
const meta = $derived(heroMeta(profile, scan, s.workspace.head7, (k, p) => t(k, p), lang));
const areas = $derived(heroAreas(profile, scan));
const langName = (l: SourceLang) => LANG_NAMES[l] || l;
function areaLabel(a: AreaStat): string {
  if (a.kind === "dir") return t("map.hero.area.dir", { dir: a.dir ?? "", lang: langName(a.lang), files: fmtInt(a.files, lang) });
  if (a.kind === "tests") return t("map.hero.area.tests", { lang: langName(a.lang), files: fmtInt(a.files, lang) });
  return t("map.hero.area.code", { lang: langName(a.lang), files: fmtInt(a.files, lang) });
}
const readme = $derived(profile?.readme ?? null);
// NC-02: once §0 is generated, its first written paragraph (with its cites) is the lede — not the README excerpt
let lede = $state<{ text: string; block: string } | null>(null);
$effect(() => {
  if (!ws || !generated) {
    lede = null;
    return;
  }
  const key = ws;
  untrack(() => {
    void s.api
      .call("GET /ws/:ws/doc/sections/:section", { params: { ws: key, section: "s0" } })
      .then((v) => {
        if (ws !== key) return;
        lede = ledeOf(v.blocks);
      })
      .catch(() => (lede = null));
  });
});
// NC-04 the 「文脈」 caption: one sentence of what the building is (the generated §0 lede, else the README's first
// paragraph), cut at the first sentence end
const contextLine = $derived(oneSentence(lede?.text ?? readme?.text ?? ""));
/** External actors on the plan (browsers, services, other repos): the people / systems around the building. */
const externals = $derived(model ? model.rooms.filter((r) => r.external).map((r) => r.label) : []);

// the 5-minute course by the name the rail and §0 give it (its real time: 「約13分コースで読む」, never a promise of 5)
const fiveName = $derived(
  courseName(s.doc.outline?.readingPaths ?? [], NEWCOMER_PATH, (id) => s.doc.index?.nodes.get(id)?.readingSec ?? 0, t, hasKey) ?? t("rail.pathName.5min"),
);
function readFiveMinutes(): void {
  if (!ws) return;
  choosePath(ws, NEWCOMER_PATH);
  void s.router.go({ name: "doc", ws, section: "s0" });
}
const expert = $derived(s.doc.level === "expert");

// ---------------------------------------------------------------- data
$effect(() => {
  if (!ws) return;
  untrack(() => void s.map.load());
});

// the static-facts tiles are the last part of the first useful screen (`mitori:facts:painted`, CR m1-102)
let factsMarked = false;
$effect(() => {
  if (scan && !factsMarked) {
    factsMarked = true;
    markAfterPaint("mitori:facts:painted");
  }
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
  // gen strings arrive with the side chunk (i18n-ns.ts `gen`): until then the tail is the task id alone
  tail = last ? (hasKey(`gen.stage.${last.stage}`) ? `${t(`gen.stage.${last.stage}`)} · ${last.target.id}` : last.target.id) : null;
});

// `?text=1` opens 「テキストで見る」 (permalink, ⌘K); closing it drops the parameter again (ux.md §4.2.6)
$effect(() => {
  if (route.name === "map" && route.textView && model) untrack(() => (s.ui.textViewOpen = true));
});

// 表示 ▾ is a `menu` layer: Escape closes it first (LAYER_ORDER)
let hudMenu: HTMLDetailsElement | undefined = $state();
// registered from the summary click itself (the toggle event is a later task: an Escape typed right after the
// click could otherwise arrive first)
function onHudMenu(open: boolean) {
  if (open) {
    if (!s.layers.isOpen("hud-menu"))
      s.layers.open("menu", "hud-menu", () => {
        if (hudMenu) hudMenu.open = false;
      });
  } else s.layers.drop("hud-menu");
}

function openTextView() {
  if (hudMenu?.open) s.layers.close("hud-menu", { restoreFocus: false });
  s.ui.textViewOpen = true;
  if (route.name === "map" && !route.textView) s.router.replaceUrl({ ...route, textView: true });
}

function closeTextView() {
  s.ui.textViewOpen = false;
  if (route.name === "map" && route.textView) {
    const { textView: _text, ...rest } = route;
    s.router.replaceUrl(rest);
  }
}

// ---------------------------------------------------------------- §3 flows (Shift+1〜5, `?flow=`, room card)
/** §3.1〜§3.5 in TOC order: the sections whose `mapFlow` the overlay draws. */
const flowSections = $derived((s.doc.index?.nodes.get("s3")?.children ?? []) as SectionId[]);
const flowSteps = $derived(s.map.flow ? (s.doc.section(s.map.flow)?.mapFlow ?? null) : null);

async function showFlow(sec: SectionId | null) {
  if (sec) await s.doc.load(sec).catch(() => null);
  s.map.flow = sec;
  if (route.name === "map") {
    const { flow: _flow, ...rest } = route;
    s.router.replaceUrl(sec ? { ...rest, flow: sec } : rest);
  }
}

/** The same flow again clears it (ux.md §4.2.3). */
function toggleFlow(sec: SectionId) {
  void showFlow(s.map.flow === sec ? null : sec);
}

$effect(() => {
  const f = route.name === "map" ? route.flow : undefined;
  if (f && f !== s.map.flow) untrack(() => void showFlow(f));
});

// the room card lists the flows through the selected room: §3.n sections are few, load them on selection
$effect(() => {
  if (!selected) return;
  const ids = flowSections;
  untrack(() => {
    for (const id of ids) s.doc.prefetch(id);
  });
});
const roomFlows = $derived.by(() => {
  const r = selected;
  if (!r) return [];
  return flowSections.flatMap((sec) => {
    const steps = (s.doc.section(sec)?.mapFlow ?? []).filter((x) => x.from === r.id || x.to === r.id).map((x) => x.step);
    return steps.length ? [{ section: sec, num: s.doc.index?.numbers.get(sec) ?? "", steps, on: s.map.flow === sec }] : [];
  });
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

// ---------------------------------------------------------------- map keys (scope: map)
onMount(() => {
  const k = s.keys;
  const offs = [
    k.on("map.zoomIn", () => controller?.stepZoom(1)),
    k.on("map.zoomOut", () => controller?.stepZoom(-1)),
    k.on("map.fit", () => controller?.fit()),
    k.on("map.flow", (e) => {
      const n = Number(/^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1] ?? 0);
      const sec = flowSections[n - 1];
      if (sec) toggleFlow(sec);
    }),
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
    s.layers.drop("hud-menu");
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
// NC-18 / NC-12: a zero tile tells a first-time reader nothing (「0 HTTPルート」)
const shownFacts = $derived(facts.filter((f) => f.n > 0 || !scan));
const stale = $derived(s.doc.outline?.counts.stale ?? 0);
const totals = $derived(s.doc.outline?.manifest.usageTotals ?? null);
// 「区画0 · 部屋5」: a zero count is not shown (NC-04 / NC-12)
const planCounts = $derived(
  model
    ? model.zones.length > 0
      ? t("map.plan.counts", { zones: model.zones.length, rooms: model.rooms.length })
      : t("map.plan.rooms", { rooms: model.rooms.length })
    : "",
);
</script>

<div class="body map-body" style:grid-template-columns="{layout.rail}px minmax(0,1fr)">
  <Rail mode={layout.railMode} />

  <main id="main" class="map-main" tabindex="-1" aria-labelledby="map-title">
    <div class="top">
      <section class="hero" data-chrome>
        <p class="kicker">
          <span class="dot" aria-hidden="true"></span>
          {#if generated && totals}
            <span>{t("map.strip.generated", generatedTokens(totals, fmtTokensImpl, (u) => fmtUsdImpl(u, "gen")))}</span>
          {:else if scan}
            <span>{t("map.strip.scanned", { files: fmtInt(scan.files, lang), s: (scan.ms / 1000).toFixed(2) })}</span><b>{t("map.strip.zeroTok")}</b>
          {:else if s.workspace.scan}
            <span>{t("map.strip.scanning", { stage: s.workspace.scan.stage, done: fmtInt(s.workspace.scan.done, lang), total: fmtInt(s.workspace.scan.total, lang) })}</span>
          {:else}
            <span class="skel kick-skel">&nbsp;</span>
          {/if}
        </p>
        <h1 id="map-title" class="title"><span data-user-content>{st?.info.name ?? " "}</span></h1>
        <p class="meta mono">
          {#each meta as m, i (i)}
            {#if i > 0}<span class="sep" aria-hidden="true">&middot;</span>{/if}
            {#if m.href}<a href={m.href} target="_blank" rel="noopener noreferrer" data-user-content>{m.text}</a>{:else}<span data-user-content={m.user || undefined}>{m.text}</span>{/if}
          {/each}
        </p>
        {#if lede && ws}
          <figure class="readme lede">
            <blockquote data-user-content>{lede.text}</blockquote>
            <figcaption>
              <a class="src" href={HREFS.doc(ws, "s0", lede.block as never)}>{t("map.lede.source")}</a>
              <span class="sep" aria-hidden="true">&middot;</span><span>{t("map.lede.note")}</span>
            </figcaption>
          </figure>
        {:else if readme && ws}
          <figure class="readme">
            <blockquote lang="" data-user-content>{readme.text}</blockquote>
            <figcaption>
              <a class="src" href={HREFS.code(ws, readme.path as RepoPath, readme.line)}>{readme.path}:{readme.line}</a>
              <span class="sep" aria-hidden="true">&middot;</span><span>{t(generated ? "map.readme.verbatimGenerated" : "map.readme.verbatim")}</span>
            </figcaption>
          </figure>
        {:else}
          <!-- AC-U03: the README / lede box is reserved until the profile says there is none (then it stays as space),
               so the plan below never moves when it arrives -->
          <div class="readme readme-ph" aria-hidden="true"><span class:skel={!profile}></span></div>
        {/if}
        {#if !areas.length}
          <div class="tiles tiles-ph" aria-hidden="true"><span class:skel={!profile && !scan}></span></div>
        {:else}
          <dl class="tiles" style:--n={areas.length}>
            {#each areas as a, i (i)}
              <div class="tile">
                <dt class="sr-only">{areaLabel(a)}</dt>
                <dd class="v"><span class="num">{fmtLocShort(a.loc)}</span><span class="unit">{t("map.hero.lines")}</span></dd>
                <dd class="l" data-user-content>{areaLabel(a)}</dd>
              </div>
            {/each}
          </dl>
        {/if}
      </section>

      <!-- AC-U03: an ungenerated repository gets the estimate card — taller than the hero: its height is reserved
           while the card's chunk loads (after the plan painted), so the plan below never moves -->
      <aside class="side" class:est={rightReady && !generated} aria-label={t("map.right")} aria-busy={!rightReady || undefined}>
        {#if rightReady && side}
          {@const GenProgress = side.GenProgress}
          {@const GenEstimateCard = side.GenEstimateCard}
          {@const EngineCard = side.EngineCard}
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
                {#if ws}<button type="button" class="btn btn-pri" onclick={readFiveMinutes}>{t("map.read5", { name: fiveName })}</button>{/if}
              </div>
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
        {:else}
          <div class="card side-skel" aria-hidden="true"></div>
        {/if}
      </aside>
    </div>

    <section class="plan-sec" aria-labelledby="plan-t">
      <header class="plan-head" data-chrome>
        <h2 id="plan-t">{t("map.plan.title")}<span class="counts">{planCounts}</span></h2>
        {#if s.map.fallback}<p class="fb">{t("map.strip.fallback")}</p>{/if}
        <div class="hud">
          <button type="button" class="chip" aria-pressed={s.map.overlays.comments} onclick={() => (s.map.overlays.comments = !s.map.overlays.comments)}>{t("map.hud.comments")}</button>
          <button type="button" class="chip" aria-pressed={s.map.overlays.working} onclick={() => (s.map.overlays.working = !s.map.overlays.working)}>{t("map.hud.working")}</button>
          <button type="button" class="chip" aria-pressed={s.map.overlays.allDeps} onclick={() => (s.map.overlays.allDeps = !s.map.overlays.allDeps)}>{t("map.hud.allDeps")}</button>
          <details class="menu" bind:this={hudMenu} ontoggle={() => onHudMenu(!!hudMenu?.open)}>
            <summary class="chip" onclick={() => onHudMenu(!hudMenu?.open)}>{t("map.hud.view")}</summary>
            <div class="pop menu-pop" role="menu">
              <label><input type="checkbox" bind:checked={s.map.overlays.freshness} /> {t("map.hud.freshness")}</label>
              <button type="button" role="menuitem" onclick={openTextView}>{t("map.hud.textView")}</button>
            </div>
          </details>
          <button type="button" class="link-btn text-link" onclick={openTextView}>{t("map.hud.textView")}</button>
        </div>
      </header>

      <div class="stage" aria-label={t("map.stage")} role="group" bind:this={stageEl}>
        {#if view && model}
          <FloorPlan
            {view}
            {text}
            selected={s.map.selected}
            overlays={s.map.overlays}
            generating={genRooms}
            done={doneRooms}
            {pins}
            flow={flowSteps}
            onselect={select}
            onopen={open}
            onstage={onStage}
            onzoom={onZoom}
            onhover={(id, rect) => (hover = id && rect && model ? { room: model.byId.get(id) as RoomModel, rect } : null)}
            bind:controller
          />
          <p id="plan-desc" class="sr-only">{t("map.text.summary", { zones: model.zones.length, rooms: model.rooms.length, edges: model.edges.length })}</p>
          {#if s.map.stage === "Z0"}
            <!-- NC-04 「文脈」: the building named and placed — what it is (§0 / README) and who is outside it -->
            <div class="ctx-cap" data-chrome>
              <p class="cn" data-user-content>{s.workspace.status?.info.name ?? ""}</p>
              {#if contextLine}<p class="cl" data-user-content>{contextLine}</p>{/if}
              {#if externals.length > 0}<p class="cx">{t("map.context.outside", { names: externals.join(" · ") })}</p>{/if}
            </div>
          {/if}
        {:else if s.map.error}
          <div class="err-card center" role="alert">
            <h2>{t("map.error")}</h2>
            <p>{errorText(s.map.error)}</p>
            <button type="button" class="btn btn-sec btn-s" onclick={() => s.workspace.rescan()}>{t("map.rescan")}</button>
          </div>
        {:else}
          <div class="stage-skel" aria-busy="true"><span>{t("app.loading")}</span></div>
        {/if}

        {#if selected && side}
          {@const sec = sectionOf(selected)}
          {@const RoomCard = side.RoomCard}
          <div class="room-float" class:left={cardLeft}>
            <RoomCard
              title={selected.zoneLabel ? `${selected.zoneLabel} › ${selected.label}` : selected.label}
              summary={selected.summary ?? t("map.room.static", { files: selected.files, loc: fmtLocShort(selected.loc) }) + (selected.topSymbols.length ? ` · ${selected.topSymbols.join(", ")}` : "")}
              freshness={selected.fresh}
              threads={selected.threads}
              section={sec}
              sectionLabel={sec ? (s.doc.index?.numbers.get(sec) ?? "") : ""}
              genTokens={genEstimateFor(selected)}
              flows={roomFlows}
              onflow={toggleFlow}
              onread={() => open(selected.id)}
              ongenerate={() => prioritize(selected)}
            />
          </div>
        {/if}

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

        {#if hover?.room && hover.room.id !== s.map.selected}
          <div class="pop l0" role="tooltip" style:left="{Math.max(8, hover.rect.left)}px" style:top="{hover.rect.bottom + 6}px" data-chrome>
            <b data-user-content>{hover.room.label}</b>
            {#if hover.room.summary}<span data-user-content>{hover.room.summary}</span>{/if}
            <span class="mono">{t("map.room.static", { files: hover.room.files, loc: fmtLocShort(hover.room.loc) })}</span>
            {#if hover.room.topSymbols.length}<span class="mono" data-user-content>{hover.room.topSymbols.join(" · ")}</span>{/if}
          </div>
        {/if}
      </div>
    </section>

    <div class="below" data-chrome>
      {#if !generated}
        <section class="zero" aria-labelledby="zero-t">
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

      <section class="facts" aria-labelledby="facts-t">
        <h2 id="facts-t" class="rail-label">{t("map.facts.title")}</h2>
        <div class="grid">
          {#each shownFacts as f (f.kind)}
            <a class="fact card" href={ws ? HREFS.doc(ws, f.sec) : "#"}><span class="n mono">{scan ? fmtInt(f.n, lang) : "–"}</span><span class="l">{t(`map.facts.${f.kind}`)}</span></a>
          {/each}
        </div>
      </section>

      {#if expert}<section class="times" aria-labelledby="times-t">
        <h2 id="times-t" class="rail-label">{t("map.times.title")}</h2>
        <ul class="mono">
          {#each ["S0", "S1", "S2", "S3", "S4"] as stg (stg)}
            <li><span>{t(`map.times.${stg}`)}</span><span>{scan?.stageMs?.[stg as "S0"] !== undefined ? `${Math.round(scan?.stageMs?.[stg as "S0"] ?? 0)} ms` : "–"}</span></li>
          {/each}
        </ul>
      </section>{/if}
    </div>
  </main>
</div>

{#if s.ui.textViewOpen && model && side}
  {@const TextViewDialog = side.TextViewDialog}
  <TextViewDialog {model} onclose={closeTextView} />
{/if}

<style>
  .map-main {
    container: map / inline-size;
    min-width: 0;
    padding: 0 40px 40px;
  }
  /* ---------------------------------------------------------------- ① hero + card */
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--map-card-w, 440px);
    gap: 24px 48px;
    align-items: start;
    padding-top: 26px;
  }
  .kicker {
    display: flex;
    align-items: center;
    height: 22px;
    gap: 8px;
    font-size: var(--fs-ui);
    color: var(--muted);
    margin: 0 0 10px;
    white-space: nowrap;
    overflow: hidden;
  }
  .kicker span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kicker b {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .kick-skel {
    width: 26em;
    height: 1.2em;
  }
  .title {
    font-family: var(--font-serif);
    font-size: clamp(40px, 4.4cqi, 54px);
    line-height: 1.08;
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    /* two lines reserved (remote · toolchain · license · HEAD wraps on most repos): the profile arriving moves nothing */
    min-height: calc(2 * 1.5em + 2px);
    line-height: 1.5;
    margin: 10px 0 0;
    font-size: var(--fs-ui);
    color: var(--muted);
  }
  .meta a {
    color: var(--muted);
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
    text-underline-offset: 3px;
  }
  .meta a:hover {
    color: var(--ink);
  }
  .sep {
    color: var(--rule-2);
  }
  .readme {
    margin: 22px 0 0;
    padding: 2px 0 2px 22px;
    border-left: 2px solid var(--rule-2);
    max-width: 44em;
  }
  .readme blockquote {
    margin: 0;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: var(--fs-body-l, 18px);
    line-height: 1.7;
    color: var(--text);
    /* three lines, always (AC-U03: a shorter excerpt must not pull the plan up when it arrives) */
    min-height: calc(3 * 1.7em);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  /* the reserved box: 3 blockquote lines + the caption line */
  .readme-ph {
    height: calc(3 * 1.7 * var(--fs-body-l, 18px) + 6px + 1.5em + 4px);
    border-left-color: transparent;
  }
  .readme-ph .skel {
    display: block;
    width: 70%;
    height: 1.2em;
    margin-top: 6px;
  }
  .tiles-ph {
    display: block;
    height: calc(14px + 30px * 1.15 + 4px + 1.5em + 14px + 2px);
  }
  .tiles-ph .skel {
    display: block;
    width: 90%;
    height: 60%;
    margin: 12px 0;
  }
  .readme figcaption {
    margin-top: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .readme .src {
    font-family: var(--font-mono);
    color: var(--muted);
    border: 1px solid var(--rule);
    background: var(--sheet);
    border-radius: var(--r-pill);
    padding: 0 7px;
  }
  .readme .src:hover {
    color: var(--ink);
    border-color: var(--rule-2);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    margin: 26px 0 0;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }
  .tile {
    padding: 14px 18px 14px 0;
    min-width: 0;
  }
  .tile + .tile {
    border-left: 1px solid var(--rule);
    padding-left: 20px;
  }
  .tile dd {
    margin: 0;
  }
  .tile .v {
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: var(--ink);
  }
  .tile .num {
    font-family: var(--font-serif);
    font-size: 30px;
    line-height: 1.15;
    font-weight: var(--fw-strong);
    font-variant-numeric: tabular-nums;
  }
  .tile .unit {
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .tile .l {
    margin-top: 4px;
    font-size: var(--fs-ui);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .side {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .side.est {
    min-height: var(--est-card-h, 464px);
  }
  .side-skel {
    min-height: 352px;
  }
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
  .plan-sec {
    margin-top: 40px;
  }
  .plan-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-bottom: 12px;
  }
  .plan-head h2 {
    font-family: var(--font-serif);
    font-size: 26px;
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .counts {
    font-family: var(--font-ui);
    font-size: var(--fs-label);
    font-weight: var(--fw-regular);
    color: var(--muted);
  }
  .fb {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
  .hud {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
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
    white-space: nowrap;
  }
  .chip[aria-pressed="true"] {
    color: var(--ink);
    border-color: var(--rule-2);
  }
  .chip[aria-pressed="true"]::before {
    content: "\2713";
    color: var(--c-ok);
  }
  .text-link {
    margin-left: 6px;
    font-size: var(--fs-label);
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
    right: 0;
    width: 220px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-ui);
    z-index: 3;
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
  .stage {
    position: relative;
    height: clamp(460px, calc(100vh - var(--hdr) - var(--status) - 128px), 860px);
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background-color: var(--paper);
    background-image: radial-gradient(circle at 1px 1px, var(--rule) 1px, transparent 1.2px);
    background-size: 16px 16px;
    overflow: hidden;
  }
  .ctx-cap {
    position: absolute;
    left: 18px;
    top: 16px;
    max-width: min(560px, calc(100% - 36px));
    padding: 10px 14px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    pointer-events: none;
    animation: pop-in var(--dur-lod) var(--ease-out);
  }
  .ctx-cap .cn {
    margin: 0;
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .ctx-cap .cl {
    margin: 2px 0 0;
    font-size: var(--fs-ui-s);
    line-height: 1.6;
    color: var(--text);
  }
  .ctx-cap .cx {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
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
  .room-float {
    position: absolute;
    top: 12px;
    right: 12px;
    width: min(320px, calc(100% - 24px));
    z-index: 2;
  }
  .room-float.left {
    right: auto;
    left: 12px;
  }
  .room-float :global(.room-card) {
    box-shadow: var(--shadow-pop);
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
  /* ---------------------------------------------------------------- ③ 0-tok band */
  .below {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 24px 40px;
    margin-top: 32px;
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
    padding: 3px 0;
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .fact {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    min-height: 62px;
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
    /* 「エントリポ／イント」: break between words only (NC-18) */
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .times li {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-label);
    color: var(--muted);
    padding: 3px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  /* fixed value box: "–" → "12 ms" never moves the text (right-aligned inside) */
  .times li span:last-child {
    min-width: 8ch;
    text-align: right;
  }
  /* ---------------------------------------------------------------- narrow containers (laptop / tablet) */
  @container map (max-width: 1080px) {
    .top {
      --map-card-w: 360px;
      --est-card-h: 484px;
      gap: 24px 32px;
    }
    .below {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .below .facts {
      grid-column: 1 / -1;
      grid-row: 1;
    }
  }
  @container map (max-width: 860px) {
    .top {
      grid-template-columns: minmax(0, 1fr);
      --est-card-h: 445px;
    }
    .side {
      max-width: none;
    }
    .stage {
      height: clamp(420px, 56vh, 720px);
    }
    .hud .text-link {
      display: none;
    }
  }
  @container map (max-width: 560px) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .tile:nth-child(3) {
      border-left: 0;
      padding-left: 0;
    }
    .below {
      grid-template-columns: minmax(0, 1fr);
    }
    .facts .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 1023px) {
    .map-main {
      padding: 0 24px 32px;
    }
  }
</style>
