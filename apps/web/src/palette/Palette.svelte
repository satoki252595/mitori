<!--
  ⌘K palette (ux.md §4.10, JUDGEMENT §6.10): 640 px, 13vh from the top, rows ≥ 44 px, 8.5 rows visible; matching
  runs in the palette worker (latest query id only). Focus stays in the input (combobox + listbox,
  aria-activedescendant); Escape closes and RETURNS focus (LayerStack). IME: `input` keeps filtering while
  composing; Enter runs only after commit (the registry's isComposing guard, IME_RULES.paletteRunsAfterCommit).
-->
<script lang="ts" module>
import type { Stores } from "../stores/app.svelte.ts";
import { DocText } from "./doctext.svelte.ts";

const texts = new WeakMap<object, DocText>();
/** One text index per store root, kept across palette openings (built once, patched by SSE). */
function docTextOf(s: Stores): DocText {
  let d = texts.get(s);
  if (!d) {
    d = new DocText({
      ws: () => s.workspace.key,
      outline: () => s.doc.outline,
      index: () => s.doc.index,
      cached: (id) => s.doc.section(id),
      load: (ws, id) => s.api.call("GET /ws/:ws/doc/sections/:section", { params: { ws, section: id }, query: { lang: s.doc.lang } }),
      onBlock: (fn) => s.doc.onBlock(fn),
    });
    texts.set(s, d);
  }
  return d;
}
</script>

<script lang="ts">
import { HREFS, type SectionId } from "@mitori/core";
import { flushSync, onMount } from "svelte";
import { copyText } from "../shell/clipboard.ts";
import { t } from "../shell/index.ts";
import { choosePath } from "../shell/reading.ts";
import { getJson, STORAGE_KEYS } from "../shell/storage.ts";
import { useStores } from "../stores/app.svelte.ts";
import { actionItems, runAction } from "./actions.ts";
import { askAi } from "./ask.ts";

const s = useStores();
const p = s.palette;
let input: HTMLInputElement | undefined = $state();
let active = $state(0);
let actionsFor = $state.raw<{ id: string; label: string; href: string } | null>(null);

type Row = {
  id: string;
  label: string;
  marks: [number, number][];
  sub?: string;
  reason?: { kind: "alias" | "via"; text: string };
  href: string;
  group: string;
  top?: boolean;
  score?: number;
  /** A near (not literal) full-text match. */
  near?: boolean;
  /** Rows that are not a link: 「AI に聞く」, the suggestions. */
  go?: () => void;
};

// ---------------------------------------------------------------- full text (NC-09): the doc's own words, indexed lazily
const docText = docTextOf(s);
const ws = $derived(s.workspace.key);
$effect(() => {
  // first open, and again when the outline changes while the palette is open
  void s.doc.outline?.outlineRev;
  void docText.ensure();
});
// a big document waits for a typing pause; a small one answers on every keystroke (the worker groups never wait)
let textQ = $state("");
$effect(() => {
  const q = p.query;
  if (docText.entries().length < 3000) {
    textQ = q;
    return;
  }
  const h = setTimeout(() => (textQ = q), 120);
  return () => clearTimeout(h);
});
const text = $derived.by(() => {
  void docText.version;
  const q = textQ.trim();
  return q ? docText.search(q, p.scope === "doc" ? 20 : 4) : { hits: [], total: 0 };
});
const askable = $derived(!!ws && !!s.doc.outline && p.scope !== "actions" && [...p.query.trim()].length >= 2);

function textRows(): Row[] {
  const w = ws;
  if (!w) return [];
  return text.hits.map((h) => ({
    id: h.entry.block,
    label: h.label,
    marks: h.marks,
    sub: `§${s.doc.index?.numbers.get(h.entry.section) ?? ""} ${s.doc.index?.nodes.get(h.entry.section)?.title ?? ""}`,
    href: HREFS.doc(w, h.entry.section, h.entry.block),
    group: "text",
    ...(h.tier === "near" ? { near: true } : {}),
  }));
}

function askRow(): Row {
  const q = p.query.trim();
  const short = [...q].length > 40 ? `${[...q].slice(0, 40).join("")}…` : q;
  const hit = text.hits[0]?.entry;
  return {
    id: "ask",
    label: t("palette.ask", { q: short }),
    marks: [],
    sub: hit
      ? t("palette.askSubAt", { num: s.doc.index?.numbers.get(hit.section) ?? "", title: s.doc.index?.nodes.get(hit.section)?.title ?? "" })
      : t("palette.askSub"),
    href: "",
    group: "ask",
    go: () => void askAi(s, q, hit ? { section: hit.section, block: hit.block } : null),
  };
}

/** The empty palette: where a newcomer starts (§0, the 5-minute course, how to run it, what this screen does). */
function suggestRows(): Row[] {
  const w = ws;
  const ix = s.doc.index;
  if (!w || !ix) return [];
  const out: Row[] = [];
  const title = (id: SectionId) => ix.nodes.get(id)?.title ?? "";
  if (ix.nodes.has("s0")) out.push({ id: "s0", label: `§0 ${title("s0")}`, marks: [], sub: t("palette.suggest.s0"), href: HREFS.doc(w, "s0"), group: "suggest" });
  const five = s.doc.outline?.readingPaths.find((x) => x.id === "5min");
  if (five && s.doc.outline?.manifest.generatedAt) {
    const read = getJson<Record<string, string>>("local", STORAGE_KEYS.read(w, five.id)) ?? {};
    const next = five.steps.find((st) => !read[st.section])?.section ?? five.steps[0]?.section;
    if (next)
      out.push({
        id: "path5",
        label: t("palette.suggest.path5"),
        marks: [],
        sub: five.steps.map((st) => `§${ix.numbers.get(st.section) ?? ""}`).join(" → "),
        href: "",
        group: "suggest",
        go: () => {
          choosePath(w, five.id);
          s.ui.readTick++;
          void s.router.go({ name: "doc", ws: w, section: next });
        },
      });
  }
  if (ix.nodes.has("s4")) out.push({ id: "s4", label: `§4 ${title("s4")}`, marks: [], sub: t("palette.suggest.s4"), href: HREFS.doc(w, "s4"), group: "suggest" });
  out.push({ id: "help", label: t("palette.suggest.help"), marks: [], sub: t("palette.suggest.helpSub"), href: "", group: "suggest", go: () => (s.ui.helpOpen = true) });
  return out;
}

const rows = $derived.by(() => {
  if (actionsFor) {
    return [
      { id: "open", label: t("palette.panel.open"), marks: [], href: actionsFor.href, group: "panel" },
      { id: "copy", label: t("palette.panel.copyLink"), marks: [], href: "", group: "panel" },
    ] as Row[];
  }
  if (!p.query.trim()) return [...suggestRows(), ...(p.recents().map((r) => ({ ...r, marks: [] as [number, number][], group: "recent" })) as Row[])];
  const out: Row[] = [];
  let top: Row | null = null;
  const want = p.top;
  for (const g of p.results)
    for (const it of g.items) {
      const r: Row = { ...it, group: g.group };
      out.push(r);
      if (want && want.group === g.group && want.id === it.id) top = r;
    }
  const found = top ? [{ ...top, top: true }, ...out.filter((r) => r !== top)] : out;
  // in 「本文」 mode the doc's words lead; otherwise they follow the index groups
  const listed = p.scope === "doc" ? [...textRows(), ...found] : [...found, ...textRows()];
  return askable ? [...listed, askRow()] : listed;
});

$effect(() => {
  void rows;
  active = 0;
});

// result count for screen readers once typing pauses 300 ms (ux.md §11.2); never per keystroke
$effect(() => {
  const q = p.query.trim();
  const n = p.total + text.total;
  if (!q || p.status !== "ready") return;
  const h = setTimeout(() => s.ui.announce(t("palette.announce", { n })), 300);
  return () => clearTimeout(h);
});

// action labels follow the UI language (t reads the reactive catalog): re-sent to the worker on a switch
$effect(() => {
  p.setActions(actionItems(t, s));
});

onMount(() => {
  // the page behind is inert while open: lift it (flush) before the layer returns the focus there
  s.layers.open("palette", "palette", () => {
    p.hide();
    flushSync();
  });
  input?.focus();
  const k = s.keys;
  const offs = [
    k.on("palette.next", () => (active = Math.min(rows.length - 1, active + 1))),
    k.on("palette.prev", () => (active = Math.max(0, active - 1))),
    k.on("palette.run", () => run(active)),
    k.on("palette.actions", () => {
      const r = rows[active];
      if (r && !actionsFor && r.href) actionsFor = { id: r.id, label: r.label, href: r.href };
    }),
    k.on("palette.back", () => (actionsFor = null)),
  ];
  return () => {
    for (const off of offs) off();
    s.layers.drop("palette");
  };
});

function close() {
  s.layers.close("palette");
}

function run(i: number) {
  const r = rows[i];
  if (!r) return;
  if (actionsFor) {
    if (r.id === "copy") void copyText(new URL(actionsFor.href || "/", location.href).href, s, "copy.permalink");
    else if (actionsFor.href) void s.router.go(s.router.parse(actionsFor.href));
    close();
    return;
  }
  if (r.go) {
    // the layer gives focus back first; the Composer (「AI に聞く」) takes it afterwards
    close();
    r.go();
    return;
  }
  if (r.group === "text") {
    s.ui.find = { block: r.id, words: r.marks.map(([a, b]) => r.label.slice(a, b)) };
    close();
    void s.router.go(s.router.parse(r.href));
    return;
  }
  if (r.group !== "recent") p.remember({ id: r.id, label: r.label, href: r.href, group: r.group as "term" });
  close();
  if (r.group === "action" || (!r.href && r.id.startsWith("action."))) runAction(r.id, s);
  else if (r.href) void s.router.go(s.router.parse(r.href));
}

function marked(label: string, marks: [number, number][]): { text: string; hit: boolean }[] {
  if (!marks.length) return [{ text: label, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a > at) out.push({ text: label.slice(at, a), hit: false });
    out.push({ text: label.slice(a, b), hit: true });
    at = b;
  }
  if (at < label.length) out.push({ text: label.slice(at), hit: false });
  return out;
}

// group glyphs; the glossary one is a word, so it comes from the catalog (EN chrome carries no Japanese, AC-J12)
const ICON: Record<string, string> = { section: "§", room: "□", symbol: "f", thread: "●", action: "›", recent: "↺", panel: "›", text: "¶", ask: "?", suggest: "→" };
const icon = (g: string) => (g === "term" ? t("palette.icon.term") : (ICON[g] ?? "›"));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim pal-scrim" onclick={(e) => e.target === e.currentTarget && close()} data-chrome>
  <div class="pal" role="dialog" aria-modal="true" aria-label={t("palette.label")}>
    <div class="pal-in">
      <svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5" /></svg>
      <input
        bind:this={input}
        role="combobox"
        aria-expanded="true"
        aria-controls="pal-list"
        aria-autocomplete="list"
        aria-activedescendant={rows[active] ? `pal-o-${active}` : undefined}
        aria-label={t("palette.inputLabel")}
        placeholder={t(p.scope === "doc" ? "palette.placeholderDoc" : "palette.placeholder")}
        value={p.query}
        oninput={(e) => p.setQuery(e.currentTarget.value, e.timeStamp)}
        autocomplete="off"
        spellcheck="false"
      />
      {#if actionsFor}<span class="crumb" data-user-content>{actionsFor.label}</span>{:else if p.scope === "doc"}<span class="crumb">{t("palette.crumbDoc")}</span>{/if}
    </div>
    <ul class="pal-list" id="pal-list" role="listbox" aria-label={t("palette.results")}>
      {#if p.status === "loading" && p.query && !p.results.length}
        {#each [0, 1, 2] as i (i)}<li class="skel row-skel" aria-hidden="true"></li>{/each}
      {/if}
      {#each rows as r, i (`${r.group}:${r.id}:${r.top ? "t" : ""}`)}
        {#if !r.top && (i === 0 || rows[i - 1]?.group !== r.group || rows[i - 1]?.top)}<li class="pal-g" role="presentation">{t(`palette.group.${r.group}`)}</li>{/if}
        {#if r.top && i === 0}<li class="pal-g" role="presentation">{t("palette.group.top")}</li>{/if}
        <li id={`pal-o-${i}`} class="pal-it" class:ask={r.group === "ask"} class:txt={r.group === "text"} role="option" aria-selected={i === active} onclick={() => run(i)} onpointermove={() => (active = i)}>
          <span class="ic" aria-hidden="true">{icon(r.group)}</span>
          <span class="mid">
            <span class="lb" data-user-content={r.group === "ask" ? undefined : true}>{#each marked(r.label, r.marks) as seg, j (j)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
            {#if r.sub}<span class="sub" class:mono={r.group !== "ask" && r.group !== "suggest"} data-user-content={r.group === "text" ? true : undefined}>{r.sub}</span>{/if}
          </span>
          {#if r.reason}<span class="via" data-user-content>{r.reason.kind === "via" ? t("palette.via", { term: r.reason.text }) : t("palette.match", { alias: r.reason.text })}</span>{/if}
          {#if r.near}<span class="near">{t("palette.near")}</span>{/if}
        </li>
      {/each}
      {#if p.query.trim() && !rows.length && p.status !== "loading"}<li class="pal-empty" role="presentation">{t("palette.empty")}</li>{/if}
      {#if p.status === "error"}<li class="pal-empty" role="presentation">{t("palette.indexError")}</li>{/if}
    </ul>
    <div class="pal-foot">
      <span data-ms={p.ms}
        >{t("palette.foot", { n: p.total + text.total, ms: p.ms })}{#if docText.status === "building"}<span class="idx"> · {t("palette.textIndexing", { done: docText.done, total: docText.total })}</span>{/if}</span
      >
      <span class="keys"><kbd>&uarr;</kbd><kbd>&darr;</kbd> {t("palette.move")} <kbd>&#x23CE;</kbd> {t("palette.open")} <kbd>{s.keys.hint("palette.actions")}</kbd> {t("palette.actions")} <kbd>Esc</kbd></span>
    </div>
  </div>
</div>

<style>
  .pal-scrim {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: var(--palette-top);
    z-index: var(--z-palette);
    animation: pop-in var(--dur-palette-in) var(--ease-out);
  }
  .pal {
    width: var(--palette-w);
    max-width: calc(100% - 32px);
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-dialog);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .pal-in {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    border-bottom: 1px solid var(--rule);
    color: var(--muted);
  }
  .pal-in input {
    flex: 1;
    height: 54px;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: var(--fs-input-l);
    color: var(--ink);
  }
  .pal-in input::placeholder {
    color: var(--faint);
  }
  .crumb {
    font-size: var(--fs-label);
    color: var(--muted);
    padding: 3px 8px;
    border-radius: 5px;
    background: var(--paper-2);
    white-space: nowrap;
  }
  .pal-list {
    list-style: none;
    margin: 0;
    max-height: var(--palette-list-max);
    overflow: auto;
    padding: 6px;
    scrollbar-width: thin;
  }
  .pal-g {
    font-size: var(--fs-meta);
    letter-spacing: 0.1em;
    color: var(--faint);
    font-weight: var(--fw-strong);
    padding: 10px 10px 4px;
  }
  .pal-it {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-height: var(--palette-row);
    padding: 6px 10px;
    border-radius: 8px;
    cursor: pointer;
  }
  .pal-it[aria-selected="true"] {
    background: var(--hover);
  }
  .ic {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    border: 1px solid var(--rule);
    color: var(--muted);
    font-family: var(--font-serif);
    font-size: var(--fs-label);
    background: var(--paper);
  }
  .mid {
    min-width: 0;
  }
  .lb {
    display: block;
    font-size: var(--fs-ui-l);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lb mark {
    background: transparent;
    color: var(--accent);
    font-weight: var(--fw-strong);
  }
  .sub {
    display: block;
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .via {
    font-size: var(--fs-meta);
    color: var(--c-prop);
    background: var(--c-prop-bg);
    padding: 1px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }
  .near {
    font-size: var(--fs-meta);
    color: var(--muted);
    border: 1px solid var(--rule);
    padding: 0 6px;
    border-radius: 4px;
    white-space: nowrap;
  }
  /* full-text rows: the snippet may take two lines (the words around the match are the point) */
  .pal-it.txt .lb {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: var(--fs-ui);
    line-height: 1.55;
  }
  /* 「AI に聞く」: the way out when the document does not say it */
  .pal-it.ask .ic {
    color: var(--accent);
    border-color: var(--accent);
    font-family: var(--font-sans);
    font-weight: var(--fw-strong);
  }
  .pal-it.ask .lb {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .idx {
    color: var(--muted);
  }
  .row-skel {
    height: 44px;
    margin: 4px 0;
    list-style: none;
  }
  .pal-empty {
    padding: 28px 16px;
    text-align: center;
    color: var(--muted);
    font-size: var(--fs-ui);
  }
  .pal-foot {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    padding: 9px 14px;
    border-top: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: var(--fs-meta);
    color: var(--faint);
    background: var(--paper);
  }
  .keys {
    display: inline-flex;
    gap: 5px;
    align-items: center;
  }
</style>
