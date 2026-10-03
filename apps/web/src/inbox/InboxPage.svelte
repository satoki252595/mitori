<!--
  S4 Inbox (contract `UiExtension.views.inbox`, ux.md §4.6 R1, JUDGEMENT §6.9, prototype 04): filter rail with counts,
  the list (`role=listbox`, multi-select with `x`, j / k move the selection AND the detail within 50 ms — AC-J45),
  the sticky batch bar on top when ≥ 2 drafts, the detail on the right (sheet below 1024 px). Rows are fetched once
  and then follow SSE (projected rows, no refetch); the selected row keeps its id when rows arrive above it.
-->
<script lang="ts">
import { HREFS, type InboxItem, type ReviewEstimate, type ThreadId } from "@mitori/core";
import { onMount, tick, untrack } from "svelte";
import type { InboxView, UiStatus } from "../contract.ts";
import { fmtTokens, fmtUsd, isComposing, t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { useStores } from "../stores/app.svelte.ts";
import { loopOf } from "../threads/loop.svelte.ts";
import StatusPill from "../threads/StatusPill.svelte";
import InboxDetail from "./InboxDetail.svelte";
import { itemStatus } from "./status.ts";
import { commonScope, INBOX_VIEWS, moduleCount, needsChoice, reselect, viewCounts, visibleRows } from "./view.ts";

const s = useStores();
const loop = loopOf(s);
const route = $derived(s.router.route);
const view = $derived<InboxView>(route.name === "inbox" ? route.view : "mine");
const ws = $derived(s.workspace.key);
let hideResolved = $state(false);
let index = $state(0);
let checked = $state.raw<ReadonlySet<string>>(new Set());
let detailRef: InboxDetail | undefined = $state();
let list: HTMLElement | undefined = $state();
const width = $derived(s.ui.width);
const narrow = $derived(width < 1024);
let showDetail = $state(false);

const rows = $derived(visibleRows(s.inbox.items, view, hideResolved));
const counts = $derived(viewCounts(s.inbox.items));
const sel = $derived(rows.items[index] ?? null);
const drafts = $derived(s.inbox.items.filter((x) => x.tags.includes("draft") && !needsChoice(x)));
const working = $derived(counts.working);
let batch = $state.raw<ReviewEstimate | null>(null);

// keep the selected id when the rows change underneath (SSE)
let prevItems: InboxItem[] = [];
let selId: string | null = null;
$effect(() => {
  const items = rows.items;
  untrack(() => {
    const i = reselect(prevItems, items, selId, index);
    if (i !== index) index = i;
    prevItems = items;
    selId = items[index]?.id ?? null;
  });
});
$effect(() => {
  // the route's `sel` picks the row on arrival
  const r = route;
  untrack(() => {
    if (r.name === "inbox" && r.sel) {
      const i = rows.items.findIndex((x) => x.id === r.sel);
      if (i >= 0) index = i;
    }
  });
});

$effect(() => {
  const ids = drafts.map((d) => d.thread ?? d.id) as ThreadId[];
  const w = ws;
  if (ids.length < 2 || !w) {
    batch = null;
    return;
  }
  void s.api.call("POST /ws/:ws/review/estimate", { params: { ws: w }, body: { threads: ids } }).then(
    (e) => (batch = e),
    () => (batch = null),
  );
});

function select(i: number, trigger?: number) {
  if (rows.items.length === 0) return;
  index = Math.max(0, Math.min(rows.items.length - 1, i));
  selId = rows.items[index]?.id ?? null;
  if (narrow) showDetail = true;
  if (route.name === "inbox" && selId) s.router.replaceUrl({ ...route, sel: selId });
  void tick().then(() => {
    list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selId ?? "")}"]`)?.scrollIntoView({ block: "nearest" });
    markAfterPaint("mitori:shortcut:handled", trigger !== undefined ? { trigger, id: "inbox.nav" } : undefined);
  });
}

function setView(v: InboxView) {
  if (!ws) return;
  index = 0;
  void s.router.go({ name: "inbox", ws, view: v }, { focus: "keep" });
}

function open(it: InboxItem) {
  if (!ws) return;
  if (it.kind === "job" && it.job && it.tags.includes("review")) return void s.router.go({ name: "review", ws, job: it.job });
  const href = it.href || (it.thread ? HREFS.thread(ws, it.thread) : "");
  if (href) void s.router.go(s.router.parse(href));
}

function toggleCheck(id: string) {
  const n = new Set(checked);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  checked = n;
}

onMount(() => {
  if (!s.inbox.loaded) void s.inbox.load();
  const k = s.keys;
  const offs = [
    k.on("inbox.next", (e) => select(index + 1, e.timeStamp)),
    k.on("inbox.prev", (e) => select(index - 1, e.timeStamp)),
    k.on("inbox.select", () => sel && toggleCheck(sel.id)),
    k.on("inbox.choose", (e) => {
      if (!sel || !needsChoice(sel)) return;
      const n = /^(?:Digit|Numpad)([12])$/.exec(e.code)?.[1];
      void detailRef?.choose(n === "1" ? "code" : "doc");
    }),
    k.on("inbox.hideResolved", () => (hideResolved = !hideResolved)),
  ];
  markAfterPaint("mitori:section:rendered", { id: "inbox" });
  s.router.painted();
  return () => {
    for (const off of offs) off();
  };
});

function onListKey(e: KeyboardEvent) {
  if (isComposing(e)) return;
  if (e.key === "Enter" && sel) {
    e.preventDefault();
    open(sel);
  }
}

function ago(iso: string): string {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 60) return t("threads.time.now");
  if (d < 3600) return t("threads.time.min", { n: Math.floor(d / 60) });
  if (d < 86400) return t("threads.time.hour", { n: Math.floor(d / 3600) });
  return d < 172800 ? t("inbox.yesterday") : t("threads.time.day", { n: Math.floor(d / 86400) });
}

const ICON: Record<Exclude<InboxView, "all">, UiStatus> = {
  mine: "open",
  working: "running",
  failed: "failed",
  outdated: "outdated",
  draft: "draft",
  uncommitted: "applied",
  resolved: "resolved",
};
const scope = $derived(commonScope(drafts.map((d) => d.anchor?.path ?? "")));
const showIds = $derived(s.doc.level === "expert");
const savePct = $derived(batch && batch.separateTokens > batch.batchTokens ? Math.round((1 - batch.batchTokens / batch.separateTokens) * 100) : null);
</script>

<div class="ib" class:narrow class:detail={showDetail}>
  <nav class="ib-rail" aria-label={t("inbox.filters")} data-chrome>
    <p class="cap">{t("inbox.show")}</p>
    {#each INBOX_VIEWS as v (v)}
      <button type="button" class="fv" class:on={view === v} aria-current={view === v ? "page" : undefined} onclick={() => setView(v)}>
        {#if v !== "all"}<StatusPill status={ICON[v]} glyphOnly label={t(`inbox.view.${v}`)} />{/if}
        <span class="l">{t(`inbox.view.${v}`)}</span><span class="n mono">{counts[v]}</span>
      </button>
    {/each}
  </nav>

  <main id="main" class="ib-main" tabindex="-1">
    <header class="ib-h" data-chrome>
      <h1>{t("title.inbox")}</h1>
      <p class="sub">
        {t("inbox.sub", { mine: counts.mine, working })}{#if s.review.round?.round} · R{s.review.round.round.n}{/if}
        · <kbd>j</kbd><kbd>k</kbd> {t("inbox.subMove")} · <kbd>↵</kbd> {t("inbox.subOpen")}
      </p>
    </header>
    {#if drafts.length >= 2}
      <div class="batch" role="region" aria-label={t("inbox.batch.label")} data-chrome>
        <div class="bt">
          <p class="l1">{checked.size > 0 ? t("inbox.batch.selected", { n: checked.size }) : t("inbox.batch.drafts", { n: drafts.length, scope: scope ?? t("inbox.batch.modules", { m: moduleCount(drafts.map((d) => d.anchor?.path ?? "")) }) })}{#if batch}{t("inbox.batch.cost", { k: fmtTokens(batch.batchTokens, { approx: true }), usd: fmtUsd(batch.apiUsd, "job") })}{/if}</p>
          {#if batch && savePct !== null}<p class="l2 mono">{t("inbox.batch.saving", { k: fmtTokens(batch.separateTokens, { approx: true }), p: savePct })}</p>{/if}
        </div>
        <button type="button" class="btn btn-sec btn-s" onclick={() => (loop.finishOpen = true)}>{t("review.pull.send")}<kbd>⇧F</kbd></button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (listbox: Enter opens the selected row) -->
    <ul class="rows" role="listbox" aria-multiselectable="true" aria-label={t(`inbox.view.${view}`)} tabindex="0" bind:this={list} onkeydown={onListKey} data-chrome>
      {#each rows.items as it, i (it.kind + it.id)}
        {#if rows.heads.has(i)}<li class="gh" role="presentation">{t(`inbox.group.${rows.heads.get(i)}`)}</li>{/if}
        {@const st = itemStatus(it)}
        <!-- svelte-ignore a11y_click_events_have_key_events (the listbox owns the keys: j / k / x / Enter) -->
        <li
          class="row"
          role="option"
          data-id={it.id}
          aria-selected={i === index}
          class:sel={i === index}
          class:chk={checked.has(it.id)}
          onclick={() => select(i)}
          ondblclick={() => open(it)}
        >
          <span class="g"><StatusPill status={st} glyphOnly /></span>
          <span class="main1">
            {#if showIds}<span class="mono id">{it.thread ?? it.id}</span>{/if}
            <span class="tt" data-user-content>{it.title}</span>
            {#if it.intent}<span class="in">{t(`composer.intent.${it.intent}`)}</span>{/if}
          </span>
          <span class="pill"><StatusPill status={st} /></span>
          <span class="main2 mono">
            {#if it.anchor?.section}§{s.doc.index?.numbers.get(it.anchor.section) ?? it.anchor.section}{/if}
            {#if it.anchor?.path} · {it.anchor.path}{#if it.anchor.line}:{it.anchor.line}{/if}{/if}
            {#if it.cost}<span class="cost"> · {it.cost.estimated ? `≈${fmtTokens(it.cost.tokens)} tok` : fmtUsd(it.cost.usd, "job")}</span>{/if}
          </span>
          <span class="time">{ago(it.updatedAt)}</span>
        </li>
      {:else}
        <li class="empty" role="presentation">{t(`inbox.empty.${view}`)}</li>
      {/each}
    </ul>
  </main>

  <aside class="ib-side" aria-label={t("inbox.detail")}>
    {#if narrow && showDetail}<button type="button" class="back btn btn-gh" onclick={() => (showDetail = false)}>← {t("inbox.back")}</button>{/if}
    {#if sel}
      {#key sel.kind + sel.id}<InboxDetail bind:this={detailRef} item={sel} onopen={open} />{/key}
    {/if}
  </aside>
</div>

<style>
  .ib {
    display: grid;
    grid-template-columns: var(--rail) minmax(0, 1fr) var(--inbox-side);
    min-height: calc(100vh - var(--hdr) - var(--status));
    align-items: start;
  }
  .ib-rail {
    position: sticky;
    top: var(--hdr);
    padding: 36px 16px 24px;
    border-right: 1px solid var(--rule-soft);
    min-height: calc(100vh - var(--hdr) - var(--status));
  }
  .cap {
    margin: 0 0 10px 8px;
    font-size: var(--fs-meta);
    color: var(--faint);
    letter-spacing: var(--ls-caps);
  }
  .fv {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 40px;
    padding: 0 12px;
    border-radius: var(--r-input);
    font-size: var(--fs-ui-m);
    color: var(--text);
    text-align: left;
  }
  .fv:hover {
    background: var(--hover);
  }
  .fv.on {
    background: var(--hover);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .fv .l {
    flex: 1;
  }
  .fv .n {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .ib-main {
    padding: 48px 56px 120px;
    min-width: 0;
  }
  .ib-h h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 2.5rem;
    font-weight: var(--fw-strong);
    color: var(--ink);
    letter-spacing: var(--ls-heading);
  }
  .ib-h .sub {
    margin: 8px 0 24px;
    font-size: var(--fs-ui);
    color: var(--muted);
  }
  .ib-h kbd {
    margin: 0 2px;
  }
  .batch {
    position: sticky;
    top: calc(var(--hdr) + 8px);
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
    padding: 14px 18px;
    border-radius: var(--r-card-l);
    background: var(--toast-bg);
    color: var(--toast-fg);
  }
  .batch .bt {
    flex: 1;
    min-width: 0;
  }
  .batch p {
    margin: 0;
  }
  .batch .l1 {
    font-size: var(--fs-ui-m);
    font-weight: var(--fw-strong);
  }
  .batch .l2 {
    font-size: var(--fs-label);
    color: var(--toast-fg-2);
  }
  .batch kbd {
    margin-left: 6px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--rule-soft);
  }
  .rows:focus {
    outline: none;
  }
  .rows:focus-visible .row.sel {
    outline: var(--focus-w) solid var(--focus-ring);
    outline-offset: -2px;
  }
  .gh {
    padding: 14px 10px 6px;
    font-size: var(--fs-label);
    color: var(--faint);
    background: var(--paper);
    letter-spacing: var(--ls-caps);
  }
  .row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    grid-template-areas: "g m1 pill" "g m2 time";
    column-gap: 8px;
    row-gap: 4px;
    min-height: var(--inbox-row-min);
    padding: 16px 16px 16px 14px;
    border-bottom: 1px solid var(--rule-soft);
    border-left: 2px solid transparent;
    cursor: pointer;
  }
  .row:hover {
    background: color-mix(in srgb, var(--hover) 50%, transparent);
  }
  .row.sel {
    background: var(--hover);
    border-left-color: var(--accent);
  }
  .row.chk .g {
    box-shadow: 0 0 0 2px var(--accent);
    border-radius: 50%;
  }
  .row .g {
    grid-area: g;
    padding-top: 3px;
  }
  .main1 {
    grid-area: m1;
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .main1 .id {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .main1 .tt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-ui-l);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .main1 .in {
    flex: none;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .main2 {
    grid-area: m2;
    font-size: var(--fs-label);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill {
    grid-area: pill;
    justify-self: end;
  }
  .time {
    grid-area: time;
    justify-self: end;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .empty {
    padding: 40px 12px;
    color: var(--muted);
  }
  .ib-side {
    position: sticky;
    top: var(--hdr);
    max-height: calc(100vh - var(--hdr) - var(--status));
    overflow: auto;
    border-left: 1px solid var(--rule-soft);
    min-height: calc(100vh - var(--hdr) - var(--status));
  }
  .ib.narrow {
    grid-template-columns: minmax(0, 1fr);
  }
  .ib.narrow .ib-rail {
    display: none;
  }
  .ib.narrow .ib-main {
    padding: 28px 16px 120px;
  }
  .ib.narrow .ib-side {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--status);
    top: auto;
    height: var(--sheet-full);
    z-index: var(--z-sheet);
    background: var(--paper);
    border-top: 1px solid var(--rule);
    border-radius: 14px 14px 0 0;
    transform: translateY(100%);
    transition: transform var(--dur-panel) var(--ease-out);
  }
  .ib.narrow.detail .ib-side {
    transform: none;
  }
  .back {
    margin: 12px 12px 0;
  }
</style>
