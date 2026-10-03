<!--
  ⌘K palette (ux.md §4.10, JUDGEMENT §6.10): 640 px, 13vh from the top, rows ≥ 44 px, 8.5 rows visible; matching
  runs in the palette worker (latest query id only). Focus stays in the input (combobox + listbox,
  aria-activedescendant); Escape closes and RETURNS focus (LayerStack). IME: `input` keeps filtering while
  composing; Enter runs only after commit (the registry's isComposing guard, IME_RULES.paletteRunsAfterCommit).
-->
<script lang="ts">
import { onMount } from "svelte";
import { copyText } from "../shell/clipboard.ts";
import { t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { actionItems, runAction } from "./actions.ts";

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
};
const rows = $derived.by(() => {
  if (actionsFor) {
    return [
      { id: "open", label: t("palette.panel.open"), marks: [], href: actionsFor.href, group: "panel" },
      { id: "copy", label: t("palette.panel.copyLink"), marks: [], href: "", group: "panel" },
    ] as Row[];
  }
  if (!p.query.trim()) return p.recents().map((r) => ({ ...r, marks: [] as [number, number][], group: "recent" })) as Row[];
  const out: Row[] = [];
  let top: Row | null = null;
  const want = p.top;
  for (const g of p.results)
    for (const it of g.items) {
      const r: Row = { ...it, group: g.group };
      out.push(r);
      if (want && want.group === g.group && want.id === it.id) top = r;
    }
  return top ? [{ ...top, top: true }, ...out.filter((r) => r !== top)] : out;
});

$effect(() => {
  void rows;
  active = 0;
});

// result count for screen readers once typing pauses 300 ms (ux.md §11.2); never per keystroke
$effect(() => {
  const q = p.query.trim();
  const n = p.total;
  if (!q || p.status !== "ready") return;
  const h = setTimeout(() => s.ui.announce(t("palette.announce", { n })), 300);
  return () => clearTimeout(h);
});

// action labels follow the UI language (t reads the reactive catalog): re-sent to the worker on a switch
$effect(() => {
  p.setActions(actionItems(t, s));
});

onMount(() => {
  s.layers.open("palette", "palette", () => p.hide());
  input?.focus();
  const k = s.keys;
  const offs = [
    k.on("palette.next", () => (active = Math.min(rows.length - 1, active + 1))),
    k.on("palette.prev", () => (active = Math.max(0, active - 1))),
    k.on("palette.run", () => run(active)),
    k.on("palette.actions", () => {
      const r = rows[active];
      if (r && !actionsFor) actionsFor = { id: r.id, label: r.label, href: r.href };
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
const ICON: Record<string, string> = { section: "§", room: "□", symbol: "f", thread: "●", action: "›", recent: "↺", panel: "›" };
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
        <li id={`pal-o-${i}`} class="pal-it" role="option" aria-selected={i === active} onclick={() => run(i)} onpointermove={() => (active = i)}>
          <span class="ic" aria-hidden="true">{icon(r.group)}</span>
          <span class="mid">
            <span class="lb" data-user-content>{#each marked(r.label, r.marks) as seg, j (j)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
            {#if r.sub}<span class="sub mono" data-user-content>{r.sub}</span>{/if}
          </span>
          {#if r.reason}<span class="via" data-user-content>{r.reason.kind === "via" ? t("palette.via", { term: r.reason.text }) : t("palette.match", { alias: r.reason.text })}</span>{/if}
        </li>
      {/each}
      {#if p.query.trim() && !rows.length && p.status !== "loading"}<li class="pal-empty" role="presentation">{t("palette.empty")}</li>{/if}
      {#if p.status === "error"}<li class="pal-empty" role="presentation">{t("palette.indexError")}</li>{/if}
    </ul>
    <div class="pal-foot">
      <span data-ms={p.ms}>{t("palette.foot", { n: p.total, ms: p.ms })}</span>
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
