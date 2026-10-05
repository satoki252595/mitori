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
import { hasKey } from "./i18n.ts";
import { t } from "./index.ts";
import { replaceChrome } from "./native.ts";
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
// Native markup, as for the map SVG: user text is escaped once, and actions are delegated on one host.
const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let content: HTMLDivElement | undefined = $state();
function railHtml(): string {
  const e = escapeHtml;
  const link = (id: SectionId) => (ws ? HREFS.doc(ws, id) : "#");
  const title = (id: SectionId) => `<b>&sect;${e(ix?.numbers.get(id) ?? "")} <span data-user-content>${e(ix?.nodes.get(id)?.title ?? "")}</span></b>`;
  let card: string;
  if (path && prog) {
    card = `<svg viewBox="0 0 34 34" aria-hidden="true"><circle class="trk" cx="17" cy="17" r="14"/><circle class="bar${prog.done ? " done" : ""}" cx="17" cy="17" r="14" stroke-dasharray="87.96" stroke-dashoffset="${87.96 * (1 - ring)}"/></svg><div class="path-h"><button type="button" class="path-t" data-act="path" aria-haspopup="true" aria-expanded="${stopsOpen}" aria-controls="path-stops"><span class="pt-name" data-user-content>${e(pathTitle)}</span>${prog.done ? `<span class="done-badge">${e(t("rail.pathDoneBadge"))}</span>` : `<span class="mono cnt">${prog.read}<span class="sl">/</span>${prog.total}</span>`}<span class="chev"><svg class="i" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4"/></svg></span></button><div class="path-s">${e(prog.done ? t("rail.pathDone", { min: prog.totalMin }) : t("rail.pathLeft", { min: prog.leftMin }))}</div></div>`;
    if (stopsOpen) {
      card += `<div class="stops" id="path-stops"><ol aria-label="${e(t("rail.pathStops"))}">${prog.stops.map((stop) => `<li><a href="${e(link(stop.section))}" data-act="stop" class="${stop.read ? "read" : ""}"><span class="sm" aria-hidden="true">${stop.read ? "&#x2713;" : ""}</span><span class="sn mono">&sect;${e(ix?.numbers.get(stop.section) ?? "")}</span><span class="sttl" data-user-content>${e(ix?.nodes.get(stop.section)?.title ?? "")}</span><span class="smin mono">${stop.min}${e(t("fmt.minShort"))}</span>${stop.read ? `<span class="sr-only">${e(t("rail.stopRead"))}</span>` : ""}</a></li>`).join("")}</ol>`;
      if ((outline?.readingPaths.length ?? 0) > 1)
        card += `<p class="others-h" id="path-others">${e(t("rail.pathPick"))}</p><ul class="others" aria-labelledby="path-others">${(outline?.readingPaths ?? []).map((p) => `<li><button type="button" data-act="course" data-id="${e(p.id)}" class="${p.id === path?.id ? "cur" : ""}" aria-pressed="${p.id === path?.id}"><span class="sm" aria-hidden="true">${p.id === path?.id ? "&#x2713;" : ""}</span><span class="sttl" data-user-content>${e(nameOf(p))}</span><span class="smin mono">${p.steps.length}</span></button></li>`).join("")}</ul>`;
      card += "</div>";
    }
  } else {
    card = `<svg viewBox="0 0 34 34" aria-hidden="true"><circle class="trk" cx="17" cy="17" r="14"/></svg><div class="path-h"><div class="path-t${planned ? "" : " muted"}">${e(t("rail.pathDefault"))}${planned ? ` <span class="mono cnt">0<span class="sl">/</span>${planned.steps}</span>` : ""}</div><div class="path-s">${planned ? e(t("rail.pathLeft", { min: planned.minutes })) : outline ? e(t("rail.pathAfterGen")) : "&mdash;"}</div></div>`;
  }
  let next: string;
  if (path && prog?.done && nextPath)
    next = `<button type="button" class="path-next as-link" data-act="next">${e(t("rail.next"))} <b data-user-content>${e(nameOf(nextPath))}</b></button>`;
  else if (path && prog?.next && ws) next = `<a class="path-next" href="${e(link(prog.next))}">${e(t("rail.next"))} ${title(prog.next)}</a>`;
  else if (planned && ws) next = `<a class="path-next" href="${e(link(planned.first))}">${e(t("rail.next"))} ${title(planned.first)}</a>`;
  else next = `<span class="path-next muted">${e(t("rail.next"))} &mdash;</span>`;
  const toc = ix
    ? rows
        .map(
          (r) =>
            `<li${r.depth > 0 ? ' class="sub"' : ""}><a href="${e(link(r.id))}" data-toc="${e(r.id)}" data-page="${e(r.page)}" data-state="${r.state}"${curPage === r.id ? ' aria-current="page"' : ""}${readMap[r.id] ? ' class="read"' : ""}><span class="n mono">${e(r.num)}</span><span class="ttl" data-user-content>${e(r.title)}</span><span class="st${r.state === "generating" ? " gen" : ""}">${r.threads > 0 ? `<span class="tb" aria-label="${e(t("toc.threads", { n: r.threads }))}">&#x25CF;${r.threads}</span>` : ""}${r.state === "stale" ? `<span class="warn" aria-label="${e(t("toc.state.stale"))}">&#x26A0;&#xFE0E;</span>` : ""}${e(r.meta)}<span class="sr-only">${e(t(`toc.state.${r.state}`))}</span></span></a>${r.id === "s6" && (ix.nodes.get("s6")?.children.length ?? 0) > 0 ? `<button type="button" class="mods" data-act="mods" aria-expanded="${openMods}" aria-label="${e(t("toc.modules"))}">${openMods ? "−" : "+"}</button>` : ""}</li>`,
        )
        .join("")
    : Array(14).fill('<li><span class="skel row-skel"></span></li>').join("");
  const meta = manifest?.generatedAt
    ? e(
        t("rail.genMeta", {
          tok: fmtTokensImpl(manifest.usageTotals.in + manifest.usageTotals.cacheRead + manifest.usageTotals.cacheWrite + manifest.usageTotals.out),
          usd: fmtUsdImpl(manifest.usageTotals.apiUsd, "gen"),
        }),
      )
    : outline
      ? e(t("rail.notGenerated"))
      : '<span aria-hidden="true">&mdash;</span>';
  return `<section class="path card" aria-label="${e(t("rail.path"))}">${card}<div class="path-f">${next}</div></section><nav class="toc-wrap" aria-label="${e(t("toc.label"))}"><h2 class="rail-label">${e(t("toc.label"))}</h2><ul class="toc"${ix ? "" : ' aria-busy="true"'}>${toc}</ul></nav><footer class="rail-foot"><div>${meta}</div><div>${covered ? e(t("rail.coverage", { inc: fmtInt(covered.filesIncluded, s.prefs.lang), all: fmtInt(covered.filesTotal, s.prefs.lang) })) : "&nbsp;"}</div><div class="mono">${e(t(s.workspace.status?.info.docCommitted ? "rail.committed" : "rail.optIn"))}</div></footer>`;
}
const initialHtml = untrack(() => railHtml());
let rendered = "";
$effect(() => {
  const html = railHtml();
  const host = content;
  if (!host || rendered === html) return;
  untrack(() => {
    const active = document.activeElement as HTMLElement | null;
    const inside = active && host.contains(active);
    const href = inside ? active.getAttribute("href") : null;
    const attr = inside
      ? active.dataset.toc
        ? ["data-toc", active.dataset.toc]
        : href
          ? ["href", href]
          : active.dataset.id
            ? ["data-id", active.dataset.id]
            : active.dataset.act
              ? ["data-act", active.dataset.act]
              : null
      : null;
    const scroll = tocWrap?.scrollTop ?? 0;
    replaceChrome(host, html);
    rendered = html;
    pathEl = host.querySelector<HTMLElement>(".path") ?? undefined;
    tocWrap = host.querySelector<HTMLElement>(".toc-wrap") ?? undefined;
    if (tocWrap) tocWrap.scrollTop = scroll;
    if (attr) host.querySelector<HTMLElement>(`[${attr[0]}="${CSS.escape(attr[1] ?? "")}"]`)?.focus({ preventScroll: true });
  });
});
function click(e: MouseEvent) {
  const button = (e.target as Element).closest<HTMLElement>("[data-act]");
  if (button) {
    switch (button.dataset.act) {
      case "path":
        stopsOpen = !stopsOpen;
        break;
      case "course":
        if (button.dataset.id) pickCourse(button.dataset.id);
        break;
      case "next":
        if (nextPath) startPath(nextPath);
        break;
      case "mods":
        openMods = !openMods;
        break;
      case "stop":
        s.layers.close("path-stops");
        break;
    }
  }
  const a = (e.target as Element).closest<HTMLElement>("a[data-toc]");
  if (a?.dataset.toc) void onToc(e, a.dataset.toc as SectionId, a.dataset.state ?? "");
}
function hover(e: PointerEvent) {
  const a = (e.target as Element).closest<HTMLElement>("a[data-page]");
  if (a?.dataset.page && !a.contains(e.relatedTarget as Node | null)) s.doc.prefetch(a.dataset.page as SectionId);
}
</script>

<aside class="rail" data-mode={mode} data-open={s.ui.railOpen ? "" : undefined} aria-label={t("rail.label")} data-chrome>
  {@render top?.()}

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (one delegated host) -->
  <div class="rail-content" bind:this={content} onclick={click} onpointerover={hover}>{@html initialHtml}</div>
</aside>

<style>
.rail-content {display: contents;}
:global(.rail .path) {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    grid-template-rows: 40px 30px;
    gap: 8px 10px;
    align-items: center;
    padding: 12px;
    flex: none;
    height: 104px;
    box-sizing: border-box;
  }:global(.rail .path svg) {
    width: 34px;
    height: 34px;
    transform: rotate(-90deg);
  }:global(.rail .trk) {
    stroke: var(--rule);
    fill: none;
    stroke-width: 3;
  }:global(.rail .bar) {
    stroke: var(--ink);
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.5s var(--ease-out);
  }:global(.rail .path-h) {
    min-width: 0;
  }:global(.rail .path) {
    position: relative;
  }:global(.rail button.path-t) {
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
  }:global(.rail button.path-t) {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
  }:global(.rail .cnt .sl) {
    margin: 0 1px;
  }:global(.rail .pt-name) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }:global(.rail button.path-t .mono),
:global(.rail .done-badge),
:global(.rail .chev) {
    flex: none;
  }:global(.rail .done-badge) {
    font-size: var(--fs-meta);
    font-weight: var(--fw-regular);
    color: var(--c-ok);
  }:global(.rail button.path-t:hover .chev) {
    color: var(--ink);
  }:global(.rail .chev) {
    align-self: center;
    display: inline-flex;
    color: var(--muted);
  }:global(.rail .chev svg) {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.6;
  }:global(.rail .bar.done) {
    stroke: var(--c-ok);
  }:global(.rail .stops) {
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
  }:global(.rail .stops ol),
:global(.rail .stops ul) {
    list-style: none;
    margin: 0;
    padding: 0;
  }:global(.rail .stops a),
:global(.rail .others button) {
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
  }:global(.rail .others button) {
    grid-template-columns: 14px minmax(0, 1fr) auto;
  }:global(.rail .others button.cur) {
    font-weight: var(--fw-strong);
    color: var(--ink);
  }:global(.rail .stops a:hover),
:global(.rail .others button:hover),
:global(.rail .others button:focus-visible) {
    background: var(--hover);
  }:global(.rail .others-h) {
    margin: 6px 8px 2px;
    padding-top: 8px;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--fs-meta);
    color: var(--muted);
  }:global(.rail .stops a.read) {
    color: var(--muted);
  }:global(.rail .sm) {
    color: var(--c-ok);
  }:global(.rail .sn),
:global(.rail .smin) {
    font-size: var(--fs-meta);
    color: var(--muted);
  }:global(.rail .sttl) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }:global(.rail .as-link) {
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-label);
  }:global(.rail .path-t) {
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }:global(.rail .path-t .mono) {
    font-weight: var(--fw-regular);
    color: var(--muted);
    font-size: var(--fs-label);
  }:global(.rail .muted) {
    color: var(--muted);
  }:global(.rail .path-s) {
    font-size: var(--fs-label);
    color: var(--muted);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }:global(.rail .path-f) {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    border-top: 1px solid var(--rule-soft);
    padding-top: 6px;
    min-width: 0;
  }:global(.rail .path-next) {
    flex: 1 1 0;
    min-width: 0;
    font-size: var(--fs-label);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }:global(.rail .path-next b) {
    font-weight: var(--fw-strong);
    color: var(--text);
  }:global(.rail .toc-wrap) {
    flex: 1 1 0;
    min-height: 96px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    margin-left: -10px;
    padding-left: 10px;
  }:global(.rail .toc) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }:global(.rail .toc li) {
    position: relative;
  }:global(.rail .toc a) {
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
  }:global(.rail .toc a:hover) {
    background: var(--hover);
    color: var(--ink);
  }:global(.rail .toc .n) {
    position: relative;
    font-size: var(--fs-meta);
    color: var(--muted);
  }:global(.rail .toc .ttl) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }:global(.rail .toc .st) {
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
    font-family: var(--font-mono);
  }:global(.rail .toc .tb) {
    margin-right: 6px;
    color: var(--muted);
  }:global(.rail .toc .st.gen) {
    color: var(--c-run);
  }:global(.rail .toc .warn) {
    color: var(--c-warn);
  }:global(.rail .toc a.read .n::before) {
    content: "";
    position: absolute;
    left: -7px;
    top: 50%;
    width: 5px;
    height: 5px;
    margin-top: -3px;
    border-radius: 50%;
    background: var(--muted);
  }:global(.rail .toc a[aria-current="page"]) {
    color: var(--ink);
    font-weight: var(--fw-strong);
    background: var(--hover);
  }:global(.rail .toc a[aria-current="page"]::before) {
    content: "";
    position: absolute;
    left: -10px;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
  }:global(.rail .toc li.sub a) {
    padding-left: 22px;
    font-size: var(--fs-ui-s);
  }:global(.rail .mods) {
    position: absolute;
    right: -6px;
    top: 2px;
    width: 24px;
    height: 24px;
    border-radius: var(--r-btn);
    color: var(--muted);
    font-family: var(--font-mono);
  }:global(.rail .mods:hover) {
    background: var(--hover);
  }:global(.rail .toc a .st) {
    padding-right: 0;
  }:global(.rail .toc li:has(.mods) a .st) {
    padding-right: 18px;
  }:global(.rail .row-skel) {
    display: block;
    height: 18px;
    margin: 5px 8px;
  }:global(.rail .rail-foot) {
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
