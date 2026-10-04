<!--
  Rail (S1 + S2; ux.md §4.2.1 / §4.3.2): optional minimap slot, reading-path card, TOC (state glyph · ≈k ·
  thread badge), generation meta. TOC click on a waiting chapter during generation prioritizes it (AC-J48).
-->
<script lang="ts">
import { HREFS, type ReadingPath, type SectionId } from "@mitori/core";
import { type Snippet, untrack } from "svelte";
import { readingMinutes, subtreeStats, tocState } from "../reader/outline.ts";
import { useStores } from "../stores/app.svelte.ts";
import { fmtInt, fmtTokensImpl, fmtUsdImpl } from "./fmt.ts";
import Icon from "./Icon.svelte";
import { hasKey } from "./i18n.ts";
import { t } from "./index.ts";
import { markAfterPaint } from "./perf.ts";
import { choosePath, nextPathAfter, pathName, pathProgress, plannedPath, readMapOf, selectedPath } from "./reading.ts";

let { mode, top }: { mode: "inline" | "drawer"; top?: Snippet } = $props();
const s = useStores();
const ix = $derived(s.doc.index);
const outline = $derived(s.doc.outline);
const ws = $derived(s.workspace.key);
const route = $derived(s.router.route);
const curPage = $derived(route.name === "doc" && ix ? (ix.pageOf.get(route.section) ?? route.section) : null);
const generating = $derived(s.gen.run?.state === "running");
const manifest = $derived(outline?.manifest ?? null);
let openMods = $state(false);
let tocWrap = $state<HTMLElement | undefined>();

// keep the current chapter visible inside the TOC scroller (never scrolls the page)
$effect(() => {
  const id = curPage;
  const w = tocWrap;
  if (!id || !w || rows.length === 0) return;
  const a = w.querySelector<HTMLElement>(`a[data-toc="${id}"]`);
  if (!a) return;
  const box = w.getBoundingClientRect();
  const r = a.getBoundingClientRect();
  if (r.top < box.top) w.scrollTop -= box.top - r.top + 8;
  else if (r.bottom > box.bottom) w.scrollTop += r.bottom - box.bottom + 8;
});
let painted = false;

$effect(() => {
  if (ix && !painted) {
    painted = true;
    markAfterPaint("mitori:toc:painted");
  }
});

// reading path (ux.md §4.3.8 / §7.2): the tab's course (default: 5 minutes at 「初めて」, NC-08), its progress
// across every course (NC-15), the completion line and the next course instead of 「残り約1分 · 次 —」
// readTick also bumps when the path is chosen (sessionStorage itself is not reactive)
const path = $derived(s.ui.readTick >= 0 ? selectedPath(outline, ws, s.doc.level) : null);
// before generation the default path is already planned (0 extra tokens later): 「30分コース 0 / 7 · 残り約30分」 (CR m1-103)
const planned = $derived(path ? null : plannedPath(outline));
const secOf = (id: SectionId) => ix?.nodes.get(id)?.readingSec ?? 0;
const readMap = $derived(s.ui.readTick >= 0 && ws && path ? readMapOf(ws, path.id) : {});
const prog = $derived(path ? pathProgress(path, readMap, secOf) : null);
const nameOf = (p: ReadingPath) => pathName(p, pathProgress(p, readMap, secOf).totalMin, t, hasKey);
const pathTitle = $derived(path ? nameOf(path) : "");
const nextPath = $derived.by(() => {
  const w = ws;
  if (!path || !prog?.done || !w || !outline) return null;
  return nextPathAfter(outline.readingPaths, path.id, (p) => pathProgress(p, readMapOf(w, p.id), secOf).done);
});
const ring = $derived(prog?.total ? prog.read / prog.total : 0);
let stopsOpen = $state(false);

function startPath(p: ReadingPath) {
  if (!ws) return;
  choosePath(ws, p.id);
  s.ui.readTick++;
  const first = pathProgress(p, readMapOf(ws, p.id), secOf).next ?? p.steps[0]?.section;
  if (first) void s.router.go({ name: "doc", ws, section: first });
}

// the course menu (ux.md §4.2/§4.3.2 「30分コース ▾」): this course's stops, then the other courses — one layer,
// closed by Escape, a pick, or a press outside the card
let pathEl: HTMLElement | undefined = $state();
$effect(() => {
  if (!stopsOpen) return;
  untrack(() => s.layers.open("menu", "path-stops", () => (stopsOpen = false)));
  const outside = (e: PointerEvent) => {
    if (pathEl && !pathEl.contains(e.target as Node)) s.layers.close("path-stops");
  };
  document.addEventListener("pointerdown", outside, true);
  return () => {
    document.removeEventListener("pointerdown", outside, true);
    s.layers.drop("path-stops");
  };
});

function pickCourse(id: string) {
  pickPath(id);
  s.layers.close("path-stops");
}

const threadCounts = $derived(ix ? s.review.threadsBySection(ix.blockSection) : new Map<string, number>());

const rows = $derived.by(() => {
  if (!ix) return [];
  // a chapter row counts its sub-sections too (they may be folded, §6)
  const subtree = (id: SectionId): number => (threadCounts.get(id) ?? 0) + (ix.nodes.get(id)?.children ?? []).reduce((n, c) => n + subtree(c), 0);
  const out: {
    id: SectionId;
    num: string;
    title: string;
    depth: number;
    state: ReturnType<typeof tocState>;
    meta: string;
    threads: number;
    page: SectionId;
  }[] = [];
  const visit = (id: SectionId, depth: number) => {
    const n = ix.nodes.get(id);
    if (!n) return;
    const st = tocState(n, subtreeStats(ix, id));
    const meta =
      st === "pending" || st === "generating"
        ? n.est
          ? `≈${fmtTokensImpl(n.est.inTokens + n.est.outTokens)}`
          : ""
        : st === "static"
          ? t("toc.static")
          : `${readingMinutes(n.readingSec)}${t("fmt.minShort")}`;
    out.push({
      id,
      num: ix.numbers.get(id) ?? "",
      title: n.title,
      depth,
      state: st,
      meta,
      threads: depth === 0 ? subtree(id) : (threadCounts.get(id) ?? 0),
      page: ix.pageOf.get(id) ?? id,
    });
    if (depth === 0 && (id !== "s6" || openMods)) for (const c of n.children) visit(c, 1);
  };
  for (const r of ix.roots) visit(r, 0);
  return out;
});

async function onToc(e: MouseEvent, id: SectionId, state: string) {
  if (generating && state === "pending") {
    e.preventDefault();
    const ok = await s.gen.prioritize(id);
    if (ok) s.bottom.toast({ id: "gen.prioritized", kind: "info", key: "toast.gen.prioritized", params: { id: ix?.numbers.get(id) ?? id } });
    if (ws) void s.router.go({ name: "doc", ws, section: id });
  }
}

function pickPath(id: string) {
  if (!ws) return;
  choosePath(ws, id);
  s.ui.readTick++;
}

const covered = $derived(manifest?.coverage ?? null);
</script>

<aside class="rail" data-mode={mode} data-open={s.ui.railOpen ? "" : undefined} aria-label={t("rail.label")} data-chrome>
  {@render top?.()}

  <!-- fixed-height card in every state (outline arriving never moves the TOC: CLS 0) -->
  <section class="path card" aria-label={t("rail.path")} bind:this={pathEl}>
    {#if path && prog}
      <svg viewBox="0 0 34 34" aria-hidden="true"
        ><circle class="trk" cx="17" cy="17" r="14" /><circle class="bar" class:done={prog.done} cx="17" cy="17" r="14" stroke-dasharray="87.96" stroke-dashoffset={87.96 * (1 - ring)} /></svg
      >
      <div class="path-h">
        <!-- 「約13分コース 0/4 ▾」 must fit the 248 px rail whole: the count is `n/m` (ux.md §4.3.8), the chevron 12 px -->
        <button type="button" class="path-t" aria-haspopup="true" aria-expanded={stopsOpen} aria-controls="path-stops" onclick={() => (stopsOpen = !stopsOpen)}>
          <span class="pt-name" data-user-content>{pathTitle}</span>
          {#if prog.done}<span class="done-badge">{t("rail.pathDoneBadge")}</span>{:else}<span class="mono cnt">{prog.read}<span class="sl">/</span>{prog.total}</span>{/if}
          <span class="chev"><Icon name="down" size={12} /></span>
        </button>
        <div class="path-s">{prog.done ? t("rail.pathDone", { min: prog.totalMin }) : t("rail.pathLeft", { min: prog.leftMin })}</div>
      </div>
      {#if stopsOpen}
        <div class="stops" id="path-stops">
          <ol aria-label={t("rail.pathStops")}>
            {#each prog.stops as st (st.section)}
              <li>
                <a href={ws ? HREFS.doc(ws, st.section) : "#"} class:read={st.read} onclick={() => s.layers.close("path-stops")}>
                  <span class="sm" aria-hidden="true">{#if st.read}&#x2713;{/if}</span>
                  <span class="sn mono">&sect;{ix?.numbers.get(st.section)}</span>
                  <span class="sttl" data-user-content>{ix?.nodes.get(st.section)?.title ?? ""}</span>
                  <span class="smin mono">{st.min}{t("fmt.minShort")}</span>
                  {#if st.read}<span class="sr-only">{t("rail.stopRead")}</span>{/if}
                </a>
              </li>
            {/each}
          </ol>
          {#if (outline?.readingPaths.length ?? 0) > 1}
            <!-- the other courses (ux.md §4.3.2: the ▾ menu chooses 5 分 / 30 分 / レビュアー / PM / SRE / repo 定義) -->
            <p class="others-h" id="path-others">{t("rail.pathPick")}</p>
            <ul class="others" aria-labelledby="path-others">
              {#each outline?.readingPaths ?? [] as p (p.id)}
                <li>
                  <button type="button" class:cur={p.id === path.id} aria-pressed={p.id === path.id} onclick={() => pickCourse(p.id)}>
                    <span class="sm" aria-hidden="true">{#if p.id === path.id}&#x2713;{/if}</span>
                    <span class="sttl" data-user-content>{nameOf(p)}</span>
                    <span class="smin mono">{p.steps.length}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    {:else if planned}
      <svg viewBox="0 0 34 34" aria-hidden="true"><circle class="trk" cx="17" cy="17" r="14" /></svg>
      <div class="path-h">
        <div class="path-t">{t("rail.pathDefault")} <span class="mono cnt">0<span class="sl">/</span>{planned.steps}</span></div>
        <div class="path-s">{t("rail.pathLeft", { min: planned.minutes })}</div>
      </div>
    {:else}
      <svg viewBox="0 0 34 34" aria-hidden="true"><circle class="trk" cx="17" cy="17" r="14" /></svg>
      <div class="path-h">
        <div class="path-t muted">{t("rail.pathDefault")}</div>
        <div class="path-s">{#if outline}{t("rail.pathAfterGen")}{:else}&mdash;{/if}</div>
      </div>
    {/if}
    <div class="path-f">
      {#if path && prog?.done && nextPath}
        <button type="button" class="path-next as-link" onclick={() => nextPath && startPath(nextPath)}>{t("rail.next")} <b data-user-content>{nameOf(nextPath)}</b></button>
      {:else if path && prog?.next && ws}
        <a class="path-next" href={HREFS.doc(ws, prog.next)}>{t("rail.next")} <b>&sect;{ix?.numbers.get(prog.next)} <span data-user-content>{ix?.nodes.get(prog.next)?.title ?? ""}</span></b></a>
      {:else if planned && ws}
        <a class="path-next" href={HREFS.doc(ws, planned.first)}>{t("rail.next")} <b>&sect;{ix?.numbers.get(planned.first)} <span data-user-content>{ix?.nodes.get(planned.first)?.title ?? ""}</span></b></a>
      {:else}
        <span class="path-next muted">{t("rail.next")} &mdash;</span>
      {/if}
    </div>
  </section>

  <nav class="toc-wrap" aria-label={t("toc.label")} bind:this={tocWrap}>
    <h2 class="rail-label">{t("toc.label")}</h2>
    {#if !ix}
      <ul class="toc" aria-busy="true">
        {#each Array(14) as _, i (i)}<li><span class="skel row-skel"></span></li>{/each}
      </ul>
    {:else}
      <ul class="toc">
        {#each rows as r (r.id)}
          <li class:sub={r.depth > 0}>
            <a
              href={ws ? HREFS.doc(ws, r.id) : "#"}
              data-toc={r.id}
              data-state={r.state}
              aria-current={curPage === r.id ? "page" : undefined}
              class:read={!!readMap[r.id]}
              onclick={(e) => onToc(e, r.id, r.state)}
              onpointerenter={() => s.doc.prefetch(r.page)}
            >
              <span class="n mono">{r.num}</span>
              <span class="ttl" data-user-content>{r.title}</span>
              <span class="st" class:gen={r.state === "generating"}>
                {#if r.threads > 0}<span class="tb" aria-label={t("toc.threads", { n: r.threads })}>&#x25CF;{r.threads}</span>{/if}
                {#if r.state === "stale"}<span class="warn" aria-label={t("toc.state.stale")}>&#x26A0;&#xFE0E;</span>{/if}
                {r.meta}
                <span class="sr-only">{t(`toc.state.${r.state}`)}</span>
              </span>
            </a>
            {#if r.id === "s6" && (ix.nodes.get("s6")?.children.length ?? 0) > 0}
              <button type="button" class="mods" aria-expanded={openMods} aria-label={t("toc.modules")} onclick={() => (openMods = !openMods)}>{openMods ? "−" : "+"}</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </nav>

  <footer class="rail-foot">
    {#if manifest?.generatedAt}
      <div>
        {t("rail.genMeta", {
          tok: fmtTokensImpl(manifest.usageTotals.in + manifest.usageTotals.cacheRead + manifest.usageTotals.cacheWrite + manifest.usageTotals.out),
          usd: fmtUsdImpl(manifest.usageTotals.apiUsd, "gen"),
        })}
      </div>
    {:else if outline}
      <div>{t("rail.notGenerated")}</div>
    {:else}
      <!-- NC-16: while the outline is on its way, nothing claims the doc is not generated -->
      <div aria-hidden="true">&mdash;</div>
    {/if}
    <div>{covered ? t("rail.coverage", { inc: fmtInt(covered.filesIncluded, s.prefs.lang), all: fmtInt(covered.filesTotal, s.prefs.lang) }) : "\u00a0"}</div>
    <div class="mono">{s.workspace.status?.info.docCommitted ? t("rail.committed") : t("rail.optIn")}</div>
  </footer>
</aside>

<style>
  .path {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    grid-template-rows: 40px 30px;
    gap: 8px 10px;
    align-items: center;
    padding: 12px;
    flex: none;
    height: 104px;
    box-sizing: border-box;
  }
  .path svg {
    width: 34px;
    height: 34px;
    transform: rotate(-90deg);
  }
  .trk {
    stroke: var(--rule);
    fill: none;
    stroke-width: 3;
  }
  .bar {
    stroke: var(--ink);
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.5s var(--ease-out);
  }
  .path-h {
    min-width: 0;
  }
  .path {
    position: relative;
  }
  /* the course name opens its stops (a popover over the TOC: the card keeps its 104 px, CLS 0) */
  button.path-t {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  button.path-t {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
  }
  /* `0/4` (ux.md §4.3.8 `n/7`): a hair of room around the slash, not a mono space each side */
  .cnt .sl {
    margin: 0 1px;
  }
  .pt-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.path-t .mono,
  .done-badge,
  .chev {
    flex: none;
  }
  .done-badge {
    font-size: var(--fs-meta);
    font-weight: var(--fw-regular);
    color: var(--c-ok);
  }
  button.path-t:hover .chev {
    color: var(--ink);
  }
  .chev {
    align-self: center;
    display: inline-flex;
    color: var(--muted);
  }
  .chev :global(svg) {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.6;
  }
  .bar.done {
    stroke: var(--c-ok);
  }
  .stops {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 6px);
    z-index: var(--z-popover);
    max-height: min(70vh, 560px);
    overflow-y: auto;
    padding: 6px;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-pop);
  }
  .stops ol,
  .stops ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .stops a,
  .others button {
    display: grid;
    grid-template-columns: 14px 34px minmax(0, 1fr) auto;
    gap: 4px;
    align-items: baseline;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--r-btn);
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-ui-s);
    color: var(--text);
  }
  .others button {
    grid-template-columns: 14px minmax(0, 1fr) auto;
  }
  .others button.cur {
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .stops a:hover,
  .others button:hover,
  .others button:focus-visible {
    background: var(--hover);
  }
  .others-h {
    margin: 6px 8px 2px;
    padding-top: 8px;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .stops a.read {
    color: var(--muted);
  }
  .sm {
    color: var(--c-ok);
  }
  .sn,
  .smin {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .sttl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .as-link {
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-label);
  }
  .path-t {
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path-t .mono {
    font-weight: var(--fw-regular);
    color: var(--muted);
    font-size: var(--fs-label);
  }
  .muted {
    color: var(--muted);
  }
  .path-s {
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path-f {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    border-top: 1px solid var(--rule-soft);
    padding-top: 6px;
    min-width: 0;
  }
  .path-next {
    flex: 1 1 0;
    min-width: 0;
    font-size: var(--fs-label);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path-next b {
    font-weight: var(--fw-strong);
    color: var(--text);
  }
  /* the TOC scrolls inside the rail: its row count arriving never moves the card or the footer */
  .toc-wrap {
    flex: 1 1 0;
    min-height: 96px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    margin-left: -10px;
    padding-left: 10px;
  }
  .toc {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .toc li {
    position: relative;
  }
  .toc a {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 2px;
    padding: 5px 8px;
    border-radius: var(--r-btn);
    color: var(--muted);
    font-size: var(--fs-ui);
    line-height: 1.45;
    min-height: 28px;
    position: relative;
  }
  .toc a:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .toc .n {
    position: relative;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .toc .ttl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .toc .st {
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
    font-family: var(--font-mono);
  }
  .toc .tb {
    margin-right: 6px;
    color: var(--muted);
  }
  .toc .st.gen {
    color: var(--c-run);
  }
  .toc .warn {
    color: var(--c-warn);
  }
  /* read dot sits in the padding: marking a chapter read never moves its number */
  .toc a.read .n::before {
    content: "";
    position: absolute;
    left: -7px;
    top: 50%;
    width: 5px;
    height: 5px;
    margin-top: -3px;
    border-radius: 50%;
    background: var(--muted);
  }
  .toc a[aria-current="page"] {
    color: var(--ink);
    font-weight: var(--fw-strong);
    background: var(--hover);
  }
  .toc a[aria-current="page"]::before {
    content: "";
    position: absolute;
    left: -10px;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .toc li.sub a {
    padding-left: 22px;
    font-size: var(--fs-ui-s);
  }
  .mods {
    position: absolute;
    right: -6px;
    top: 2px;
    width: 24px;
    height: 24px;
    border-radius: var(--r-btn);
    color: var(--muted);
    font-family: var(--font-mono);
  }
  .mods:hover {
    background: var(--hover);
  }
  .toc a .st {
    padding-right: 0;
  }
  /* §6 carries the ± button at the right edge: its state text stops before it */
  .toc li:has(.mods) a .st {
    padding-right: 18px;
  }
  .row-skel {
    display: block;
    height: 18px;
    margin: 5px 8px;
  }
  .rail-foot {
    margin-top: auto;
    flex: none;
    min-height: calc(3 * 1.7em + 10px);
    font-size: var(--fs-meta);
    line-height: 1.7;
    color: var(--faint);
    padding: 10px 8px 0;
    border-top: 1px solid var(--rule-soft);
  }
</style>
