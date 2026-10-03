<!--
  ⌘K in the export (ux.md §4.10): the app's matcher (palette/search.ts: kana / romaji / aliases / fuzzy, run on the
  main thread here — the index is a few hundred items) over the embedded palette index, plus a 「本文」 group that
  searches what the blocks say. Same markup and look as palette/Palette.svelte. Focus stays in the input
  (combobox + listbox); Escape closes and returns focus; Enter runs only after an IME commit.
-->
<script lang="ts">
import { onMount, tick } from "svelte";
import type { PaletteActionItem } from "../contract.ts";
import { buildIndex, runQuery } from "../palette/search.ts";
import Icon from "../shell/Icon.svelte";
import { isComposingImpl } from "../shell/ime.ts";
import { t } from "../shell/index.ts";
import { routeOfHref } from "./route.ts";
import { useViewer } from "./state.svelte.ts";
import { buildTextIndex, searchText, type TextEntry } from "./textsearch.ts";

const v = useViewer();
let input: HTMLInputElement | undefined = $state();
let query = $state("");
let active = $state(0);
let opener: HTMLElement | null = null;
let textIx: TextEntry[] | null = null;

type Row = { id: string; group: string; label: string; marks: [number, number][]; sub?: string; reason?: string; run: () => void };

const ACTIONS: { id: string; key: string; run: () => void }[] = [
  { id: "go.map", key: "goMap", run: () => v.go({ name: "map", room: null }) },
  { id: "go.doc", key: "goDoc", run: () => v.go(v.home()) },
  { id: "level.newcomer", key: "levelNewcomer", run: () => v.setLevel("newcomer") },
  { id: "level.standard", key: "levelStandard", run: () => v.setLevel("standard") },
  { id: "level.expert", key: "levelExpert", run: () => v.setLevel("expert") },
  { id: "theme.light", key: "themeLight", run: () => v.setTheme("light") },
  { id: "theme.dark", key: "themeDark", run: () => v.setTheme("dark") },
  { id: "theme.system", key: "themeSystem", run: () => v.setTheme("system") },
  { id: "lang.en", key: "langEn", run: () => v.setLang("en") },
  { id: "lang.ja", key: "langJa", run: () => v.setLang("ja") },
  { id: "cites", key: "toggleCites", run: () => (v.showCites = !v.showCites) },
  { id: "help", key: "help", run: () => (v.helpOpen = true) },
];

const items = v.payload.palette.items;
const ix = $derived(
  buildIndex(
    0,
    items,
    ACTIONS.map((a): PaletteActionItem => ({ k: "a", i: a.id, l: t(`palette.action.${a.key}`), al: [t(`palette.action.${a.key}.alias`)] })),
  ),
);

const GROUP_ICON: Record<string, string> = { term: "語", section: "§", room: "部", symbol: "ƒ", action: "⌘", text: "文" };

function close() {
  v.paletteOpen = false;
}

function runHref(href: string) {
  const r = routeOfHref(href);
  if (r) v.go(r);
}

const rows = $derived.by<Row[]>(() => {
  const raw = query.trim();
  const out: Row[] = [];
  if (raw === "") {
    for (const p of v.index.pages.filter((x) => !x.includes("/")).slice(0, 14))
      out.push({
        id: p,
        group: "section",
        label: `${v.index.numbers.get(p)}  ${v.index.nodes.get(p)?.title ?? p}`,
        marks: [],
        run: () => v.go({ name: "doc", section: p, block: null }),
      });
    return out;
  }
  const textOnly = raw.startsWith("/");
  const q = textOnly ? raw.slice(1) : raw;
  if (!textOnly) {
    const res = runQuery(ix, q, "all", 6);
    for (const g of res.groups)
      for (const it of g.items) {
        const act = g.group === "action" ? ACTIONS.find((a) => a.id === it.id) : null;
        out.push({
          id: `${g.group}:${it.id}`,
          group: g.group,
          label: it.label,
          marks: it.marks,
          ...(it.sub ? { sub: it.sub } : {}),
          ...(it.reason
            ? { reason: it.reason.kind === "via" ? t("palette.via", { term: it.reason.text }) : t("palette.match", { alias: it.reason.text }) }
            : {}),
          run: act ? act.run : () => runHref(it.href),
        });
      }
  }
  textIx ??= buildTextIndex(v.payload.sections);
  const found = searchText(textIx, q, textOnly ? 12 : 6);
  for (const h of found.hits) {
    const e = h.entry;
    out.push({
      id: `text:${e.block}`,
      group: "text",
      label: h.label,
      marks: h.marks,
      sub: `§${v.index.numbers.get(e.section) ?? ""} ${v.index.nodes.get(e.section)?.title ?? ""}`,
      run: () => v.go({ name: "doc", section: e.section, block: e.block }),
    });
  }
  return out;
});

$effect(() => {
  void rows;
  active = 0;
});

function run(i: number) {
  const r = rows[i];
  if (!r) return;
  close();
  r.run();
}

function key(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
    return;
  }
  if (isComposingImpl(e)) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    active = Math.min(rows.length - 1, active + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    active = Math.max(0, active - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    run(active);
  } else if (e.key === "Tab") e.preventDefault();
  void tick().then(() => document.getElementById(`pal-o-${active}`)?.scrollIntoView({ block: "nearest" }));
}

const segs = (label: string, marks: [number, number][]) => {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a > at) out.push({ text: label.slice(at, a), hit: false });
    out.push({ text: label.slice(a, b), hit: true });
    at = b;
  }
  if (at < label.length) out.push({ text: label.slice(at), hit: false });
  return out;
};

onMount(() => {
  opener = document.activeElement as HTMLElement | null;
  input?.focus();
  return () => {
    // return focus to where the palette was opened (unless the click moved it somewhere else on purpose)
    if (opener && document.contains(opener) && (document.activeElement === document.body || document.activeElement === input)) opener.focus();
  };
});

let announced = $state("");
$effect(() => {
  const n = rows.length;
  const q = query.trim();
  if (!q) return;
  const id = setTimeout(() => (announced = t("palette.announce", { n })), 300);
  return () => clearTimeout(id);
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim pal-scrim" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="pal" role="dialog" aria-modal="true" aria-label={t("palette.label")}>
    <div class="pal-in">
      <Icon name="search" />
      <input
        bind:this={input}
        bind:value={query}
        role="combobox"
        aria-expanded="true"
        aria-controls="pal-list"
        aria-autocomplete="list"
        aria-activedescendant={rows[active] ? `pal-o-${active}` : undefined}
        aria-label={t("palette.inputLabel")}
        placeholder={t("export.search.placeholder")}
        onkeydown={key}
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <ul class="pal-list" id="pal-list" role="listbox" aria-label={t("palette.results")}>
      {#each rows as r, i (r.id)}
        {#if i === 0 || rows[i - 1]?.group !== r.group}<li class="pal-g" role="presentation">{r.group === "text" ? t("export.search.text") : t(`palette.group.${r.group}`)}</li>{/if}
        <li id={`pal-o-${i}`} class="pal-it" role="option" aria-selected={i === active} onclick={() => run(i)} onpointermove={() => (active = i)}>
          <span class="ic" aria-hidden="true">{GROUP_ICON[r.group] ?? "·"}</span>
          <span class="mid">
            <span class="lb" data-user-content>{#each segs(r.label, r.marks) as seg, j (j)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
            {#if r.sub}<span class="sub mono" data-user-content>{r.sub}</span>{/if}
          </span>
          {#if r.reason}<span class="via" data-user-content>{r.reason}</span>{/if}
        </li>
      {/each}
      {#if query.trim() && rows.length === 0}<li class="pal-empty" role="presentation">{t("export.search.empty")}</li>{/if}
    </ul>
    <div class="pal-foot">
      <span>{t("export.search.foot")}</span>
      <span class="keys"><kbd>&uarr;</kbd><kbd>&darr;</kbd> {t("palette.move")} <kbd>&#x23CE;</kbd> {t("palette.open")} <kbd>Esc</kbd></span>
    </div>
    <p class="sr-only" aria-live="polite">{announced}</p>
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
