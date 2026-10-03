<!--
  Rail of the export (ux.md §4.3.2 minus generation): reading-path card, TOC (state glyph · minutes), document meta.
  Same markup and styling as shell/Rail.svelte; the data is the payload and the links are hash routes.
-->
<script lang="ts">
import type { SectionId } from "@mitori/core";
import { readingMinutes, subtreeStats, tocState } from "../reader/outline.ts";
import { t } from "../shell/index.ts";
import { formatHash } from "./route.ts";
import { useViewer } from "./state.svelte.ts";

let { mode }: { mode: "inline" | "drawer" } = $props();
const v = useViewer();
const ix = v.index;
const outline = v.payload.outline;
const curPage = $derived(v.route.name === "doc" ? v.pageOf(v.route.section) : null);
let openMods = $state(false);
let tocWrap = $state<HTMLElement | undefined>();

const PATH_KEY = "mitori-export:path";
let pathId = $state<string | null>(null);
try {
  pathId = localStorage.getItem(PATH_KEY);
} catch {
  /* none */
}
const path = $derived(
  outline.readingPaths.find((p) => p.id === pathId) ?? outline.readingPaths.find((p) => p.id === "30min") ?? outline.readingPaths[0] ?? null,
);
const readCount = $derived(path ? path.steps.filter((s) => v.read.has(s.section)).length : 0);
const nextStep = $derived(path?.steps.find((s) => !v.read.has(s.section)) ?? null);
const leftMin = $derived(
  path ? readingMinutes(path.steps.filter((s) => !v.read.has(s.section)).reduce((n, s) => n + (ix.nodes.get(s.section)?.readingSec ?? 0), 0)) : 0,
);
const ring = $derived(path?.steps.length ? readCount / path.steps.length : 0);

function pick(id: string) {
  pathId = id;
  try {
    localStorage.setItem(PATH_KEY, id);
  } catch {
    /* none */
  }
}

const href = (s: SectionId) => formatHash({ name: "doc", section: s, block: null });

const rows = $derived.by(() => {
  const out: { id: SectionId; num: string; title: string; depth: number; state: ReturnType<typeof tocState>; meta: string; page: SectionId }[] = [];
  const visit = (id: SectionId, depth: number) => {
    const n = ix.nodes.get(id);
    if (!n) return;
    const st = tocState(n, subtreeStats(ix, id));
    out.push({
      id,
      num: ix.numbers.get(id) ?? "",
      title: n.title,
      depth,
      state: st,
      meta: st === "static" ? t("toc.static") : st === "pending" ? "" : `${readingMinutes(n.readingSec)}${t("fmt.minShort")}`,
      page: ix.pageOf.get(id) ?? id,
    });
    if (depth === 0 && (id !== "s6" || openMods)) for (const c of n.children) visit(c, 1);
  };
  for (const r of ix.roots) visit(r, 0);
  return out;
});

// keep the current chapter visible inside the TOC scroller (never scrolls the page)
$effect(() => {
  const id = curPage;
  const w = tocWrap;
  if (!id || !w || rows.length === 0) return;
  const a = w.querySelector<HTMLElement>(`a[data-toc="${CSS.escape(id)}"]`);
  if (!a) return;
  const box = w.getBoundingClientRect();
  const r = a.getBoundingClientRect();
  if (r.top < box.top) w.scrollTop -= box.top - r.top + 8;
  else if (r.bottom > box.bottom) w.scrollTop += r.bottom - box.bottom + 8;
});

const counts = outline.counts;
</script>

<aside class="rail" data-mode={mode} data-open={v.railOpen ? "" : undefined} aria-label={t("rail.label")} data-chrome>
  <section class="path card" aria-label={t("rail.path")}>
    {#if path}
      <svg viewBox="0 0 34 34" aria-hidden="true"
        ><circle class="trk" cx="17" cy="17" r="14" /><circle class="bar" cx="17" cy="17" r="14" stroke-dasharray="87.96" stroke-dashoffset={87.96 * (1 - ring)} /></svg
      >
      <div class="path-h">
        <div class="path-t"><span data-user-content>{path.title}</span> <span class="mono">{readCount} / {path.steps.length}</span></div>
        <div class="path-s">{t("export.path.left", { min: leftMin })}</div>
      </div>
      <div class="path-f">
        {#if nextStep}
          <a class="path-next" href={href(nextStep.section)}>{t("rail.next")} <b>&sect;{ix.numbers.get(nextStep.section)} <span data-user-content>{ix.nodes.get(nextStep.section)?.title ?? ""}</span></b></a>
        {:else}
          <span class="path-next muted">{t("export.path.done")}</span>
        {/if}
        {#if outline.readingPaths.length > 1}
          <select class="path-pick" aria-label={t("rail.pathPick")} value={path.id} onchange={(e) => pick(e.currentTarget.value)}>
            {#each outline.readingPaths as p (p.id)}<option value={p.id}>{p.title}</option>{/each}
          </select>
        {/if}
      </div>
    {:else}
      <svg viewBox="0 0 34 34" aria-hidden="true"><circle class="trk" cx="17" cy="17" r="14" /></svg>
      <div class="path-h">
        <div class="path-t muted">{t("rail.pathDefault")}</div>
        <div class="path-s">{t("export.path.none")}</div>
      </div>
    {/if}
  </section>

  <nav class="toc-wrap" aria-label={t("toc.label")} bind:this={tocWrap}>
    <h2 class="rail-label">{t("toc.label")}</h2>
    <ul class="toc">
      {#each rows as r (r.id)}
        <li class:sub={r.depth > 0}>
          <a
            href={href(r.id)}
            data-toc={r.id}
            data-state={r.state}
            aria-current={curPage === r.id ? "page" : undefined}
            class:read={v.read.has(r.id)}
            onclick={() => (v.railOpen = false)}
          >
            <span class="n mono">{r.num}</span>
            <span class="ttl" data-user-content>{r.title}</span>
            <span class="st">
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
  </nav>

  <footer class="rail-foot">
    <div>{t("export.rail.stats", { blocks: counts.blocks, claims: counts.claims })}</div>
    <div>{t("export.rail.trust", { v: counts.verified, n: counts.claims })}</div>
    <div class="mono">{v.payload.outline.manifest.models[0] ?? " "}</div>
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
  .path-pick {
    flex: none;
    max-width: 45%;
    font-size: var(--fs-meta);
    border: 1px solid var(--rule);
    border-radius: var(--r-btn);
    background: var(--sheet);
    color: var(--muted);
    height: 24px;
  }
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
  .toc .warn {
    color: var(--c-warn);
  }
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
  .toc li:has(.mods) a .st {
    padding-right: 18px;
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
