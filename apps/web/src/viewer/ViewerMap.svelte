<!--
  見取り図 tab of the export (ux.md §4.2, read-only): the document's title and facts, the plan the daemon laid out (the
  app's FloorPlan / PlanController — pan, zoom, room selection — over `payload.map`) beside the "5分で分かる" pane, and
  the room card that jumps into the section. No generation, no overlays that need a daemon (threads, jobs, churn).
-->
<script lang="ts">
import type { SectionId } from "@mitori/core";
import { buildPlanModel, renderPlanSvg } from "@mitori/core";
import { untrack } from "svelte";
import type { ZoomStage } from "../contract.ts";
import FloorPlan from "../map/FloorPlan.svelte";
import type { PlanController } from "../map/plan-dom.ts";
import RoomCard from "../map/RoomCard.svelte";
import type { PlanText, RoomModel } from "../map/render.ts";
import { fmtInt, fmtLocShort } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { formatHash } from "./route.ts";
import { useViewer } from "./state.svelte.ts";

const v = useViewer();
const ix = v.index;
const view = v.payload.map;
const model = view ? buildPlanModel(view) : null;
let controller = $state.raw<PlanController | null>(null);
let selected = $state<string | null>(null);
let stage = $state<ZoomStage>("Z1");
let allDeps = $state(false);
let hover = $state.raw<{ room: RoomModel; rect: DOMRect } | null>(null);
const ZOOMS: ZoomStage[] = ["Z0", "Z1", "Z2"];

const text: PlanText = {
  get title() {
    return t("map.aria.plan");
  },
  roomLabel: (r) => t("map.aria.room", { zone: r.zoneLabel, room: r.label, files: r.files, n: r.threads }),
  roomHref: (r) => (r.section ? formatHash({ name: "doc", section: r.section, block: null }) : "#"),
  files: (n) => t("map.room.files", { n }),
};
// Self-contained exports retain their hash links and never fetch the daemon's presentation.
const presented = $derived.by(() => {
  void v.lang;
  return view && model ? { ...view, plan: model, svg: renderPlanSvg(model, text, "plan-desc") } : null;
});
const overlays = $derived({ comments: false, working: false, churn: false, freshness: true, allDeps, legend: false });
const none = new Set<string>();
const room = $derived(selected && model ? (model.byId.get(selected) ?? null) : null);
const QUICK_MAX = 5;
const quick = $derived(
  (view?.quick ?? [])
    .map((id) => v.blocks.get(id))
    .filter((b) => b !== undefined)
    .slice(0, QUICK_MAX),
);
const planCounts = $derived(model ? t("map.plan.counts", { zones: model.zones.length, rooms: model.rooms.length }) : "");
const head = v.payload.meta.head?.slice(0, 7) ?? "";
const exported = $derived(
  new Date(v.payload.meta.exportedAt).toLocaleDateString(v.lang === "ja" ? "ja-JP" : "en-US", { year: "numeric", month: "short", day: "numeric" }),
);
const cov = v.payload.outline.manifest.coverage;
const counts = v.payload.outline.counts;
const tiles = $derived([
  { k: "files", n: fmtInt(cov.filesIncluded, v.lang) },
  { k: "loc", n: fmtInt(cov.locIncluded, v.lang) },
  { k: "modules", n: fmtInt(cov.modulesTotal, v.lang) },
  { k: "claims", n: fmtInt(counts.claims, v.lang) },
  { k: "verified", n: fmtInt(counts.verified, v.lang) },
]);

function open(node: string) {
  const sec = model?.byId.get(node)?.section;
  if (sec) v.go({ name: "doc", section: sec, block: null });
}

// a room named by the URL (`#/map?room=md_…`) is selected
$effect(() => {
  const r = v.route;
  if (r.name !== "map" || !r.room || !model) return;
  const id = r.room;
  untrack(() => {
    const hit = model.rooms.find((x) => x.module === id || x.id === id);
    if (hit) selected = hit.id;
  });
});

const pages = $derived(ix.pages.filter((p) => !p.includes("/")));
const sectionOf = (r: RoomModel): SectionId | null => r.section;
</script>

<main id="main" class="map-main" tabindex="-1">
  <header class="vm-head">
    <p class="kicker">{t("nav.map")}</p>
    <h1 class="title" data-user-content>{v.payload.outline.manifest.title}</h1>
    <p class="meta mono">{#if head}<span>{head}</span><span class="sep">&middot;</span>{/if}<span>{exported}</span></p>
    <dl class="tiles">
      {#each tiles as tile (tile.k)}
        <div class="tile"><dd class="mono">{tile.n}</dd><dt>{t(`export.map.tile.${tile.k}`)}</dt></div>
      {/each}
    </dl>
  </header>

  <div class="vm-grid" class:solo={quick.length === 0}>
    <section class="plan-sec" aria-labelledby="plan-t">
      <header class="plan-head" data-chrome>
        <h2 id="plan-t">{t("map.plan.title")}<span class="counts">{planCounts}</span></h2>
        {#if view}
          <div class="hud">
            <button type="button" class="chip" aria-pressed={allDeps} onclick={() => (allDeps = !allDeps)}>{t("export.map.allDeps")}</button>
          </div>
        {/if}
      </header>

      {#if presented && model}
        <div class="stage" aria-label={t("map.stage")} role="group">
          <FloorPlan
            view={presented}
            {text}
            {selected}
            {overlays}
            generating={none}
            done={none}
            pins={{}}
            onselect={(id) => (selected = id)}
            onopen={open}
            onstage={(z) => (stage = z)}
            onhover={(id, rect) => (hover = id && rect ? { room: model.byId.get(id) as RoomModel, rect } : null)}
            bind:controller
          />
          <p id="plan-desc" class="sr-only">{t("map.plan.counts", { zones: model.zones.length, rooms: model.rooms.length })}</p>
          {#if room}
            {@const sec = sectionOf(room)}
            <div class="room-float">
              <RoomCard
                title={room.zoneLabel ? `${room.zoneLabel} › ${room.label}` : room.label}
                summary={room.loc > 0 ? t("map.room.static", { files: room.files, loc: fmtLocShort(room.loc) }) : room.path}
                freshness={room.fresh}
                threads={0}
                section={sec}
                sectionLabel={sec ? (ix.numbers.get(sec) ?? "") : ""}
                genTokens={null}
                onread={() => open(room.id)}
                ongenerate={() => {}}
              />
            </div>
          {/if}
          <div class="zoombar" role="group" aria-label={t("map.zoom.label")} data-chrome>
            <div class="seg" role="group" aria-label={t("map.zoom.stages")}>
              {#each ZOOMS as z (z)}
                <button type="button" aria-pressed={stage === z} onclick={() => controller?.zoomToStage(z)}>{t(`map.zoom.${z}`)}</button>
              {/each}
            </div>
            <button type="button" class="icon-btn" aria-label={t("map.zoom.out")} onclick={() => controller?.stepZoom(-1)}>&minus;</button>
            <button type="button" class="icon-btn" aria-label={t("map.zoom.in")} onclick={() => controller?.stepZoom(1)}>+</button>
            <button type="button" class="icon-btn" aria-label={t("map.zoom.fit")} onclick={() => controller?.fit()}>&#x2922;</button>
          </div>
          {#if hover?.room}
            <div class="pop l0" role="tooltip" style:left="{Math.max(8, hover.rect.left)}px" style:top="{hover.rect.bottom + 6}px" data-chrome>
              <b data-user-content>{hover.room.label}</b>
              <span class="mono">{hover.room.loc > 0 ? t("map.room.static", { files: hover.room.files, loc: fmtLocShort(hover.room.loc) }) : hover.room.path}</span>
            </div>
          {/if}
        </div>
        <p class="hint">{t("export.map.hint")}</p>
      {:else}
        <p class="hint">{t("export.map.none")}</p>
        <ul class="cards">
          {#each pages as p (p)}
            <li><a class="card" href={formatHash({ name: "doc", section: p, block: null })}><span class="mono n">{ix.numbers.get(p)}</span> <span data-user-content>{ix.nodes.get(p)?.title}</span></a></li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if quick.length}
      <aside class="quick" aria-labelledby="quick-t">
        <h2 id="quick-t" class="rail-label">{t("export.map.quick")}</h2>
        <div class="prose">
          {#each quick as b (b.id)}
            <div class="blk" data-b={b.id} data-depth={b.depth} data-kind={b.kind}>{@html b.html}</div>
          {/each}
        </div>
        <a class="btn btn-pri btn-s" href={formatHash(v.home())}>{t("export.map.readDoc")}</a>
      </aside>
    {/if}
  </div>
</main>

<style>
  .map-main {
    grid-column: 1 / -1;
    min-width: 0;
    padding: 0 40px 56px;
    max-width: 1440px;
    margin: 0 auto;
    width: 100%;
  }
  .vm-head {
    padding-top: 28px;
  }
  .kicker {
    margin: 0 0 8px;
    font-size: var(--fs-ui);
    color: var(--muted);
  }
  .title {
    font-family: var(--font-serif);
    font-size: clamp(36px, 4.4vw, 52px);
    line-height: 1.1;
    font-weight: var(--fw-strong);
    color: var(--ink);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .meta {
    display: flex;
    gap: 8px;
    margin: 10px 0 0;
    font-size: var(--fs-ui);
    color: var(--muted);
  }
  .sep {
    color: var(--rule-2);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin: 22px 0 0;
    max-width: 760px;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }
  .tile {
    display: flex;
    flex-direction: column-reverse;
    padding: 12px 16px 12px 0;
    min-width: 0;
  }
  .tile + .tile {
    border-left: 1px solid var(--rule);
    padding-left: 18px;
  }
  .tile dd {
    margin: 0;
    font-size: 22px;
    color: var(--ink);
  }
  .tile dt {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .vm-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 400px);
    gap: 36px;
    align-items: start;
    margin-top: 30px;
  }
  .vm-grid.solo {
    grid-template-columns: minmax(0, 1fr);
  }
  .quick {
    position: sticky;
    top: calc(var(--hdr) + 16px);
    max-height: calc(100vh - var(--hdr) - 40px);
    overflow: auto;
    scrollbar-width: thin;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    padding: 4px 4px 12px 0;
  }
  .quick .prose {
    padding: 0;
    width: 100%;
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
  .stage {
    position: relative;
    height: clamp(460px, calc(100vh - var(--hdr) - 160px), 860px);
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background-color: var(--paper);
    background-image: radial-gradient(circle at 1px 1px, var(--rule) 1px, transparent 1.2px);
    background-size: 16px 16px;
    overflow: hidden;
  }
  .room-float {
    position: absolute;
    top: 12px;
    right: 12px;
    width: min(320px, calc(100% - 24px));
    z-index: 2;
  }
  .zoombar {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    z-index: 2;
  }
  .zoombar .icon-btn {
    width: 28px;
    height: 28px;
  }
  .hint {
    margin: 10px 2px 0;
    color: var(--muted);
    font-size: var(--fs-label);
  }
  .l0 {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    font-size: var(--fs-label);
    pointer-events: none;
  }
  .cards {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .cards .card {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    color: var(--ink);
  }
  .cards .n {
    color: var(--muted);
  }
  @media (max-width: 1100px) {
    .vm-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .quick {
      position: static;
      max-height: none;
    }
  }
  @media (max-width: 720px) {
    .map-main {
      padding: 0 16px 40px;
    }
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .tile + .tile {
      border-left: 0;
      padding-left: 0;
    }
  }
</style>
