<!--
  Composer (contract `ComposerProps`, ux.md §6.2 R1, JUDGEMENT §6.5, prototype 03b). Top to bottom: header
  (`○ 下書き · §id · file:line` + autosave state), quote, intent chips (⌘1–4), the 2-way target for `change` on a doc
  anchor, the body (Enter = newline, ⌘⏎ sends, IME keys ignored), context chips, then ONE footer line (estimate ·
  router · path · 送信). `COMPOSER_DENSITY` per reader level: newcomer shows one cost line and folds chips / router /
  path under 「詳細 ▸」 (UXP-14). Keys go through the registry (`composer` scope while this layer is on top).
-->
<script lang="ts">
import { DEFAULT_LIMITS, type ExecMode, type SymbolEntry, type ThreadIntent, tokenBand } from "@mitori/core";
import { onMount, tick } from "svelte";
import { COMPOSER_DENSITY, type ExecPath } from "../contract.ts";
import { VisibleClock } from "../gen/visibility.ts";
import { usualBand } from "../jobs/stages.ts";
import { fmtTokens, isComposing, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { loopOf } from "../threads/loop.svelte.ts";
import EstimateChip from "./EstimateChip.svelte";
import { dropMention, type MentionQuery, mentionAt } from "./mention.ts";
import { instrTokens } from "./predict.ts";
import RouterChip from "./RouterChip.svelte";
import type { ComposerSession } from "./session.svelte.ts";

let { session, placement = "margin", showIds = false }: { session: ComposerSession; placement?: "margin" | "inline" | "sheet"; showIds?: boolean } = $props();

const s = useStores();
const loop = loopOf(s);
const c = $derived(session);
const level = $derived(s.doc.level);
const density = $derived(COMPOSER_DENSITY[level]);
const showMore = $derived(c.details || density.chips === "visible");
const INTENTS: { i: ThreadIntent; key: string }[] = [
  { i: "question", key: "1" },
  { i: "change", key: "2" },
  { i: "review", key: "3" },
  { i: "note", key: "4" },
];
let root: HTMLElement | undefined = $state();
let ta: HTMLTextAreaElement | undefined = $state();
let mdArea: HTMLTextAreaElement | undefined = $state();
const layerId = $derived(`composer:${c.tempKey}`);
const num = $derived(s.doc.index?.numbers.get(c.target.section) ?? "");
const est = $derived(c.estimate);
const p = $derived(c.predicted);
/** A doc chip names its block by id (`doc:b_…`); the reader wants 「§4 動かしてみる」. */
function chipLabel(it: { key: string; kind: string; label: string }): string {
  if (it.kind !== "doc" || !it.key.startsWith("doc:b_")) return it.label;
  const sec = s.doc.index?.blockSection.get(it.key.slice(4) as never);
  const n = sec ? s.doc.index?.numbers.get(sec) : undefined;
  const title = sec ? (s.doc.section(sec)?.section.title ?? "") : "";
  return n ? `§${n}${title ? ` ${title}` : ""}` : it.label;
}
/** The `@` mention a server estimate item (`code:<path>:<a>-<b>`) was made from — it carries the mention's ×, so the chip is not shown twice. */
const mentionOf = (key: string): number => c.mentions.findIndex((m) => key === `code:${m.path}:${m.start}-${m.end}`);
const limits = $derived(s.session.settings?.settings.limits ?? DEFAULT_LIMITS);
const engineId = $derived(est?.estimate.engine ?? s.session.settings?.settings.defaultEngine ?? "claude-cli");
const billing = $derived(est?.estimate.billing ?? s.session.engine(engineId)?.billing ?? "unknown");
const seconds = $derived(usualBand(p.mode, est?.history));
const docPrimary = $derived(c.target.anchor.primary === "doc");
const docTarget = $derived(c.intent === "change" && c.fixTarget === "doc");
const emptyAsk = $derived(!c.body.trim() && c.intent === "question" && density.emptyBodySends);
/**
 * A Fix needs code to write (CR ux-F1): a cite of the anchor, a picked candidate or an `@` mention. Run here (⚡) the
 * pick travels as `context.add`; your own session (⤴) and Copy (⧉) get the router's scope of the thread alone — the
 * anchor's cites — so an uncited sentence goes ⚡ (cr-requests/ux.md #6).
 */
const blockedOnTarget = $derived(c.targetsPending || c.pushOnly || (c.path === "push" && c.needsTarget));
const canSend = $derived(docTarget ? c.docChanged : (c.body.trim().length > 0 || emptyAsk) && !blockedOnTarget);
/** Candidates offered (only while the anchor has no cite: cites ARE the target). ⌥1–4 picks one. */
const offered = $derived((c.targets?.cited.length ?? 0) > 0 ? [] : c.openCandidates.slice(0, 4));
/** Estimate items the 「対象コード」 row already shows (cites and picked / mentioned ranges). */
const targetKeys = $derived(new Set([...(c.targets?.cited ?? []), ...c.mentions].map((x) => `code:${x.path}:${x.start}-${x.end}`)));
const pendingGates = $derived([...loop.trust.values()].filter((r) => r.item === "gates" && r.status === "pending").length);
const policyAcked = $derived(!!s.session.settings?.settings.privacy.dataPolicyAck[engineId]);
const needsPolicy = $derived(c.runsJob && c.path === "push" && !policyAcked && s.session.settings !== null);
const PATHS: ExecPath[] = ["push", "pull", "copy"];

// ------------------------------------------------------------------------------- layer + keys (composer scope)
onMount(() => {
  s.layers.open("composer", layerId, () => loop.closeComposer());
  const k = s.keys;
  const offs = [
    k.on("composer.submit", (e) => void send(e.timeStamp)),
    k.on("composer.intent", (e) => {
      const n = /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1];
      const hit = INTENTS.find((x) => x.key === n);
      if (hit) c.setIntent(hit.i);
    }),
    k.on("composer.close", () => {
      if (mention) {
        mention = null;
        return;
      }
      s.layers.closeTop();
    }),
  ];
  void tick().then(() => (docTarget ? mdArea : ta)?.focus({ preventScroll: true }));
  return () => {
    for (const off of offs) off();
    s.layers.drop(layerId);
  };
});

// A margin card is placed at its block: low in the viewport its chips / estimate / 送信 row fall below the fold
// (live finding, 1440×900), and it keeps growing (chips, the estimate, more lines). Whenever it GROWS, bring the
// whole card back into view ("nearest": nothing moves when it already fits; a shrink never scrolls).
$effect(() => {
  const el = root;
  if (!el || placement === "sheet" || typeof ResizeObserver === "undefined") return;
  let last = el.offsetHeight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // the margin column grows to hold the card one frame later (its min-height follows the layout): when the first
  // scroll could not reach the bottom yet (a short page), try once more after that layout
  const reveal = (again: boolean) => {
    el.scrollIntoView({ block: "nearest" });
    if (again && el.getBoundingClientRect().bottom > innerHeight + 1) timer = setTimeout(() => reveal(false), 160);
  };
  // opened already taller than the room below its block (its 対象コード arrived before this effect ran — ux finishing
  // pass, 1440×900 on §4): bring it in once at open, too
  timer = setTimeout(() => reveal(true), 120);
  const ro = new ResizeObserver(() => {
    const h = el.offsetHeight;
    const grew = h > last;
    last = h;
    if (!grew) return;
    clearTimeout(timer);
    timer = setTimeout(() => reveal(true), 80);
  });
  ro.observe(el);
  return () => {
    ro.disconnect();
    clearTimeout(timer);
  };
});

// ------------------------------------------------------------------------------- data disclosure (UXP-04)
let disc: HTMLElement | undefined = $state();
const clock = new VisibleClock();
let nudge = $state(false);
$effect(() => {
  if (!disc) return;
  const io = new IntersectionObserver(
    (en) => {
      for (const x of en) clock.entry(x.isIntersecting && x.intersectionRatio >= 0.9, performance.now(), () => new Date().toISOString());
    },
    { threshold: [0, 0.9, 1] },
  );
  io.observe(disc);
  return () => io.disconnect();
});

async function send(trigger?: number) {
  if (!canSend) return;
  if (mention) return;
  if (needsPolicy) {
    if (clock.visibleMs(performance.now()) < 1000) {
      nudge = true;
      setTimeout(() => (nudge = false), 1200);
      return;
    }
    const at = new Date().toISOString();
    const plan = s.session.engine(engineId)?.plan ?? "unknown";
    await s.prefs.patchNow({ privacy: { dataPolicyAck: { [engineId]: { at, shownAt: clock.shownAt ?? at, plan } } } });
    await s.session.loadSettings();
  }
  await loop.submit(c, trigger);
}

// ------------------------------------------------------------------------------- body + mention picker
let mention = $state.raw<MentionQuery | null>(null);
let hits = $state.raw<SymbolEntry[]>([]);
let hitIx = $state(0);
let mTimer: ReturnType<typeof setTimeout> | null = null;

function grow(el: HTMLTextAreaElement) {
  if (CSS.supports?.("field-sizing", "content")) return;
  requestAnimationFrame(() => {
    el.style.height = "auto";
    el.style.height = `${Math.min(220, Math.max(62, el.scrollHeight))}px`;
  });
}

function onInput(e: Event) {
  const el = e.currentTarget as HTMLTextAreaElement;
  c.input(el.value);
  grow(el);
  const m = mentionAt(el.value, el.selectionStart ?? el.value.length);
  mention = m;
  if (m) {
    if (mTimer) clearTimeout(mTimer);
    mTimer = setTimeout(() => void lookup(m.query), 150);
  }
}

async function lookup(q: string) {
  const ws = s.workspace.key;
  if (!ws) return;
  try {
    hits = await s.api.call("GET /ws/:ws/symbols", { params: { ws }, query: { q, limit: 8 } });
    hitIx = 0;
  } catch {
    hits = [];
  }
}

function pickMention(h: SymbolEntry) {
  const el = ta;
  if (!el || !mention) return;
  const r = dropMention(el.value, mention, el.selectionStart ?? el.value.length);
  c.input(r.text);
  c.addMention({ path: h.path, start: h.start, end: h.end });
  mention = null;
  hits = [];
  void tick().then(() => {
    el.focus();
    el.setSelectionRange(r.caret, r.caret);
  });
}

/** `@` at the caret (a space first when needed) and the symbol picker open — the 「@ 追加」 chip and the hint's button. */
function startMention() {
  if (!ta) return;
  const v = `${c.body}${c.body && !/\s$/.test(c.body) ? " " : ""}@`;
  c.input(v);
  ta.value = v;
  ta.focus();
  ta.setSelectionRange(v.length, v.length);
  mention = { at: v.length - 1, query: "" };
  void lookup("");
}

function onKey(e: KeyboardEvent) {
  if (isComposing(e)) return;
  if (!mention && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    const n = /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1];
    const tg = n && c.path === "push" ? offered[Number(n) - 1] : undefined;
    if (tg) {
      e.preventDefault();
      c.pickTarget(tg);
    }
    return;
  }
  if (!mention || hits.length === 0) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    hitIx = (hitIx + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
  } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const h = hits[hitIx];
    if (h) pickMention(h);
  }
}

function cyclePath() {
  const i = PATHS.indexOf(c.path);
  c.setPath(PATHS[(i + 1) % PATHS.length] as ExecPath);
}

const pathLabel = $derived(
  c.path === "push"
    ? t("composer.path.push", { engine: engineId })
    : c.path === "pull"
      ? t("composer.path.pull", { n: loop.waiting?.clients ?? 0 })
      : t("composer.path.copy"),
);
const saveLabel = $derived(c.save === "saving" ? t("composer.save.saving") : c.save === "offline" ? t("composer.save.offline") : t("composer.save.auto"));
const sendLabel = $derived(
  !c.runsJob
    ? c.intent === "note"
      ? t("composer.send.note")
      : docTarget
        ? t("composer.send.doc")
        : t("composer.send")
    : c.path === "copy"
      ? t("composer.send.copy")
      : t("composer.send"),
);
</script>

<section class="composer" bind:this={root} data-place={placement} aria-label={t("composer.label")} data-chrome>
  <header class="cm-h">
    <span class="dr"><span class="o" aria-hidden="true">○</span>{t("composer.draft")}</span>
    <span class="sep" aria-hidden="true">·</span><span class="mono">§{num}</span>
    {#if c.target.fileLine}<span class="sep" aria-hidden="true">·</span><span class="mono fl" data-user-content>{c.target.fileLine}</span>{/if}
    {#if showIds}<span class="sep" aria-hidden="true">·</span><span class="mono id">{c.target.block}</span>{/if}
    <span class="sv" class:off={c.save === "offline"} aria-live="polite">{saveLabel}</span>
  </header>

  <blockquote class="cm-q" data-user-content>{c.target.quote.before}<mark>{c.target.quote.mark}</mark>{c.target.quote.after}</blockquote>

  <div class="intents" role="radiogroup" aria-label={t("composer.intent.label")}>
    {#each INTENTS as x (x.i)}
      <button type="button" role="radio" aria-checked={c.intent === x.i} class:on={c.intent === x.i} onclick={() => c.setIntent(x.i)}
        >{t(`composer.intent.${x.i}`)}<kbd>{s.keys.label(`Mod+${x.key}`)}</kbd></button
      >
    {/each}
  </div>

  {#if c.intent === "change" && docPrimary}
    <div class="aim" role="radiogroup" aria-label={t("composer.aim.label")}>
      <label class:on={c.fixTarget === "code"}><input type="radio" name="aim-{c.tempKey}" checked={c.fixTarget === "code"} onchange={() => void c.setTarget("code")} />{t("composer.aim.code")}</label>
      <label class:on={c.fixTarget === "doc"}><input type="radio" name="aim-{c.tempKey}" checked={c.fixTarget === "doc"} onchange={() => void c.setTarget("doc")} />{t("composer.aim.doc")}</label>
    </div>
  {/if}

  {#if docTarget}
    {#if c.docMd === undefined}
      <div class="skel md-skel" aria-busy="true"></div>
    {:else}
      <textarea
        bind:this={mdArea}
        class="body md"
        aria-label={t("composer.md.label")}
        value={c.docMd}
        oninput={(e) => {
          c.setDocMd((e.currentTarget as HTMLTextAreaElement).value);
          grow(e.currentTarget as HTMLTextAreaElement);
        }}
      ></textarea>
      {#if c.dropped?.length}
        <div class="warnbox" role="alert">
          <p>{t("composer.md.dropped", { n: c.dropped.length, list: c.dropped.map((d) => d.label).join(t("composer.listSep")) })}</p>
          <div class="row">
            <button type="button" class="btn btn-sec btn-s" onclick={() => c.docBase && c.setDocMd(c.docBase.md)}>{t("composer.md.restore")}</button>
            <button type="button" class="btn btn-pri btn-s" onclick={() => void loop.saveDocEdit(c, true)}>{t("composer.md.dropSave")}</button>
          </div>
        </div>
      {/if}
      {#if c.conflict}
        <div class="warnbox" role="alert">
          <p>{t("composer.md.conflict")}</p>
          <div class="three">
            <div><p class="k">{t("composer.md.base")}</p><pre data-user-content>{c.conflict.base}</pre></div>
            <div><p class="k">{t("composer.md.theirs")}</p><pre data-user-content>{c.conflict.other}</pre></div>
            <div><p class="k">{t("composer.md.mine")}</p><pre data-user-content>{c.docMd}</pre></div>
          </div>
          <div class="row">
            <button type="button" class="btn btn-pri btn-s" onclick={() => void loop.overwriteDocEdit(c)}>{t("composer.md.overwrite")}</button>
            <button type="button" class="btn btn-sec btn-s" onclick={() => loop.closeComposer()}>{t("composer.md.discard")}</button>
          </div>
        </div>
      {/if}
    {/if}
  {:else}
    <div class="body-wrap">
      <textarea
        bind:this={ta}
        class="body"
        aria-label={t("composer.body.label")}
        placeholder={c.intent === "question" && density.emptyBodySends ? t("composer.body.placeholderAsk") : t(`composer.body.placeholder.${c.intent}`)}
        value={c.body}
        oninput={onInput}
        onkeydown={onKey}
      ></textarea>
      {#if mention}
        <ul class="mention" role="listbox" aria-label={t("composer.mention.label")}>
          {#each hits as h, i (h.key)}
            <li role="option" aria-selected={i === hitIx}><button type="button" onmousedown={(e) => e.preventDefault()} onclick={() => pickMention(h)}><span class="mono">{h.qualname}</span><span class="pth mono">{h.path}:{h.start}-{h.end}</span></button></li>
          {:else}
            <li class="empty">{t("composer.mention.empty")}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if c.wantsTargets}
    <div class="targets" class:need={c.needsTarget || c.pushOnly} role="group" aria-label={t("composer.targets.label")}>
      <div class="tg-row">
        <span class="tg-k">{t("composer.targets.label")}</span>
        {#if c.targetsPending}<span class="tg-wait">{t("composer.targets.loading")}</span>{/if}
        {#each c.targets?.cited ?? [] as tg (tg.label)}
          <span class="chip tg cited" title={`${tg.path}:${tg.start}-${tg.end}\n${t("composer.targets.citedHelp")}`}
            ><span class="lb mono" data-user-content>{tg.label}</span>{#if tg.symbol}<span class="sym mono" data-user-content>{tg.symbol}</span>{/if}<span class="tk mono">{fmtTokens(tg.tokens)}</span></span
          >
        {/each}
        {#each c.path === "push" ? c.mentions : [] as m, i (m.label)}
          <span class="chip tg" title={m.path}
            ><span class="lb mono" data-user-content>{m.label}</span>{#if m.symbol}<span class="sym mono" data-user-content>{m.symbol}</span>{/if}<button
              type="button"
              class="x"
              aria-label={t("composer.chips.remove", { label: m.label })}
              onclick={() => c.removeMention(i)}>×</button
            ></span
          >
        {/each}
        {#if c.hasTarget && !c.pushOnly}
          {#each c.path === "push" ? offered : [] as tg (`${tg.path}:${tg.start}`)}
            <button type="button" class="chip cand" title={tg.path} onclick={() => c.pickTarget(tg)}>+ <span data-user-content>{tg.label}</span></button>
          {/each}
          {#if c.path === "push"}<button type="button" class="chip add" onclick={startMention}>@ {t("composer.chips.add")}</button>{/if}
          <span class="tg-files" title={c.writeFiles.join("\n")}>{t("composer.targets.files", { n: c.writeFiles.length })}</span>
          <!-- the anchor's cites are always written (loop spec §3.2, cr-requests/ux.md #2): narrowing = selecting one sentence -->
          {#if (c.targets?.cited.length ?? 0) > 1}<span class="tg-files">· {t("composer.targets.narrow")}</span>{/if}
        {/if}
      </div>
      {#if c.pushOnly}
        <!-- a thread carries no code range of its own: ⤴ / ⧉ would hand the agent an empty write scope (WRITE -) -->
        <div class="tg-none" role="status">
          <p>{t("composer.targets.pushOnly")}</p>
          <p class="tg-alt"><button type="button" class="btn btn-sec btn-s" onclick={() => c.setPath("push")}>{t("composer.targets.toPush")}</button></p>
        </div>
      {:else if c.needsTarget}
        {#if offered.length > 0}
          <p class="tg-ask">{t("composer.targets.pick")}</p>
          <ul class="tg-cands">
            {#each offered as tg, i (`${tg.path}:${tg.start}`)}
              <li>
                <button type="button" class="cand-row" title={`${tg.path}:${tg.start}-${tg.end}`} aria-label={t("composer.targets.pickAria", { label: tg.label })} onclick={() => c.pickTarget(tg)}>
                  <span class="plus" aria-hidden="true">+</span>
                  <span class="lb mono" data-user-content>{tg.label}</span>
                  <span class="sym mono" data-user-content>{tg.symbol ?? ""}</span>
                  <kbd>{s.keys.label(`Alt+${i + 1}`)}</kbd>
                  <span class="why">{t(`composer.targets.source.${tg.source}`)} · <span class="mono" data-user-content>{tg.path}</span></span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="tg-none" role="status">
            <p>{t("composer.targets.none")}</p>
            <p class="tg-alt">
              <button type="button" class="btn btn-sec btn-s" onclick={startMention}>{t("composer.targets.point")}</button>
              <span>{t("composer.targets.altAsk", { ask: s.keys.label("Mod+1") })}</span>
            </p>
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if density.chips === "collapsed" && c.runsJob}
    <button type="button" class="more" aria-expanded={c.details} onclick={() => (c.details = !c.details)}>{c.details ? t("composer.details.close") : t("composer.details.open")}</button>
  {/if}

  {#if c.runsJob && showMore}
    <div class="chips" aria-label={t("composer.chips.label")}>
      {#each c.orderedChips as ch (ch.item.key)}
        {#if c.wantsTargets && targetKeys.has(ch.item.key)}
          <!-- shown in the 「対象コード」 row -->
        {:else if ch.item.kind === "fixed" || ch.item.kind === "rules"}
          <span class="chip fixed mono" title={t("composer.chips.fixedHelp")}>{t("composer.chips.fixed", { label: ch.item.label, k: fmtTokens(ch.item.tokens) })}</span>
        {:else if ch.state === "candidate"}
          <button type="button" class="chip cand" onclick={() => c.toggleChip(ch.item.key, "included")}
            >+ {t("composer.chips.related")} <span data-user-content>{ch.item.label}</span> <span class="tk mono">+{fmtTokens(ch.item.tokens)}</span></button
          >
        {:else}
          <span class="chip" class:removed={ch.state === "removed"}>
            <span class="lb" data-user-content>{chipLabel(ch.item)}</span><span class="tk mono">{fmtTokens(ch.item.tokens)}</span>
            {#if mentionOf(ch.item.key) >= 0}
              <button type="button" class="x" aria-label={t("composer.chips.remove", { label: ch.item.label })} onclick={() => c.removeMention(mentionOf(ch.item.key))}>×</button>
            {:else if ch.item.removable}
              {#if ch.state === "removed"}
                <button type="button" class="x" aria-label={t("composer.chips.restore", { label: ch.item.label })} onclick={() => c.toggleChip(ch.item.key, "included")}>+</button>
              {:else}
                <button type="button" class="x" aria-label={t("composer.chips.remove", { label: ch.item.label })} onclick={() => c.toggleChip(ch.item.key, "removed")}>×</button>
              {/if}
            {/if}
          </span>
        {/if}
      {/each}
      {#if !c.wantsTargets}
        {#each c.mentions as m, i (m.label)}
          {#if !c.orderedChips.some((x) => x.item.key === `code:${m.path}:${m.start}-${m.end}`)}
          <span class="chip"><span class="lb mono" data-user-content>{m.label}</span><button type="button" class="x" aria-label={t("composer.chips.remove", { label: m.label })} onclick={() => c.removeMention(i)}>×</button></span>
          {/if}
        {/each}
        <button type="button" class="chip add" onclick={startMention}>@ {t("composer.chips.add")}</button>
      {/if}
    </div>
  {/if}

  {#if needsPolicy}
    <p class="disc" class:nudge bind:this={disc}>{t("composer.policy", { engine: engineId })}</p>
  {/if}
  {#if c.runsJob && c.intent === "change" && pendingGates > 0}
    <p class="gatewarn">{t("composer.gates.pending", { n: pendingGates })} <button type="button" class="link" onclick={() => (loop.trustOpen = [...loop.trust.values()].find((r) => r.status === "pending") ?? null)}>{t("trust.action.review")}</button></p>
  {/if}
  {#if c.error}<p class="err" role="alert">{t(`error.${c.error}`)}</p>{/if}

  <footer class="cm-f">
    {#if docTarget}
      <span class="zero mono">{t("composer.est.zero")}</span>
    {:else if c.intent === "note"}
      <span class="zero">{t("composer.est.note")}</span>
    {:else if density.estimate === "line" && !c.details}
      <EstimateChip form="line" tokensIn={p.tokensIn} tokensOut={p.tokensOut} usd={p.usd} {seconds} band={tokenBand(p.tokensIn + p.tokensOut)} items={c.chips.map((x) => x.item)} accuracy={{ pct: est?.estimate.confidencePct ?? 25, n: est?.estimate.calibrationN ?? 0 }} model={est?.estimate.model ?? p.mode} {billing} />
    {:else if est}
      <EstimateChip
        tokensIn={p.tokensIn}
        tokensOut={p.tokensOut}
        usd={p.usd}
        {seconds}
        band={tokenBand(p.tokensIn + p.tokensOut)}
        items={c.chips.filter((x) => x.state === "included").map((x) => x.item)}
        accuracy={{ pct: est.estimate.confidencePct, n: est.estimate.calibrationN }}
        model={c.override?.model ?? est.estimate.model}
        {billing}
        instr={instrTokens(c.body)}
        flash={c.flash}
        pending={c.stale}
      />
    {:else if c.needsTarget}
      <span class="zero">{t("composer.est.needsTarget")}</span>
    {:else}
      <span class="zero">{c.draft || c.estimating || c.targetsPending ? t("composer.est.loading") : t("composer.est.prior", { lo: seconds.lo, hi: seconds.hi })}</span>
    {/if}
    {#if c.runsJob && est && (density.router === "visible" || c.details)}
      <RouterChip mode={p.mode} lines={p.lines} files={p.files} model={c.override?.model ?? est.route.model} reason={p.reason} maxLines={limits.patchMaxLines} maxFiles={limits.patchMaxFiles} override={c.override} onoverride={(o) => c.setOverride(o as { mode?: ExecMode })} />
    {/if}
    {#if c.intent !== "note" && !docTarget && (density.path === "visible" || c.details)}
      <button type="button" class="path" onclick={cyclePath} aria-label={t("composer.path.label", { path: pathLabel })}><span class="pi" aria-hidden="true">{c.path === "push" ? "⚡" : c.path === "pull" ? "⤴" : "⧉"}</span>{pathLabel}</button>
    {/if}
    <span class="grow"></span>
    <button type="button" class="btn btn-pri btn-s send" disabled={!canSend} onclick={(e) => void send(e.timeStamp)}>{sendLabel}<kbd>{s.keys.label("Mod+Enter")}</kbd></button>
  </footer>
  <p class="hint">{t("composer.hint", { send: s.keys.label("Mod+Enter") })}</p>
</section>

<style>
  .composer {
    padding: 14px 16px 12px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card-l);
    background: var(--sheet);
    box-shadow: var(--shadow-pop);
    font-size: var(--fs-ui);
    color: var(--text);
  }
  .composer[data-place="sheet"] {
    border-radius: var(--r-card-l) var(--r-card-l) 0 0;
  }
  .cm-h {
    display: flex;
    align-items: baseline;
    gap: 5px;
    font-size: var(--fs-label);
    color: var(--muted);
    min-width: 0;
  }
  .cm-h .dr {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .cm-h .o {
    margin-right: 4px;
    color: var(--muted);
  }
  .cm-h .fl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .cm-h .id {
    font-size: var(--fs-meta);
  }
  .cm-h .sv {
    margin-left: auto;
    font-size: var(--fs-meta);
    white-space: nowrap;
  }
  .cm-h .sv.off {
    color: var(--c-warn);
  }
  .cm-q {
    margin: 10px 0 12px;
    padding: 8px 12px;
    border-radius: var(--r-input);
    background: var(--paper);
    color: var(--muted);
    font-size: var(--fs-ui-s);
    line-height: 1.75;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .cm-q mark {
    background: var(--mark);
    color: var(--ink);
    border-radius: var(--r-mark);
  }
  .intents {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .intents button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: var(--r-btn);
    background: var(--sheet);
    color: var(--text);
    font-size: var(--fs-ui-s);
  }
  .intents button:hover {
    border-color: var(--rule-2);
  }
  .intents button.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }
  .intents kbd {
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    opacity: 0.6;
    font-size: var(--fs-meta);
  }
  .aim {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 10px;
    font-size: var(--fs-ui-s);
  }
  .aim label {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--r-btn);
    color: var(--muted);
    cursor: pointer;
  }
  .aim label.on {
    color: var(--ink);
    background: var(--paper);
  }
  .aim input {
    accent-color: var(--ink);
    margin: 0;
  }
  .body-wrap {
    position: relative;
  }
  .body {
    display: block;
    width: 100%;
    margin-top: 10px;
    min-height: 62px;
    max-height: 220px;
    field-sizing: content;
    padding: 10px 12px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-input);
    background: var(--sheet);
    color: var(--ink);
    font: inherit;
    font-size: var(--fs-ui-m);
    line-height: 1.65;
    resize: none;
    overflow-y: auto;
  }
  .body:focus {
    outline: none;
    border-color: var(--ink);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .body.md {
    font-family: var(--font-prose);
    font-size: var(--fs-ui-l);
    max-height: 360px;
  }
  .md-skel {
    height: 120px;
    margin-top: 10px;
  }
  .mention {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: var(--z-popover);
    list-style: none;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    box-shadow: var(--shadow-pop);
    max-height: 240px;
    overflow: auto;
  }
  .mention button {
    display: flex;
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
    padding: 5px 8px;
    border-radius: var(--r-btn);
    font-size: var(--fs-label);
    text-align: left;
  }
  .mention li[aria-selected="true"] button,
  .mention button:hover {
    background: var(--hover);
  }
  .mention .pth {
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .mention .empty {
    padding: 6px 8px;
    color: var(--muted);
    font-size: var(--fs-label);
  }
  .more {
    margin-top: 8px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .more:hover {
    color: var(--ink);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 28px;
    padding: 0 4px 0 9px;
    border: 1px solid var(--rule);
    border-radius: var(--r-chip-l);
    background: var(--paper);
    font-size: var(--fs-label);
    color: var(--text);
  }
  .chip .lb {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip .tk {
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .chip .x {
    width: 24px;
    height: 24px;
    border-radius: var(--r-chip);
    color: var(--muted);
  }
  .chip .x:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .chip.removed .lb,
  .chip.removed .tk {
    text-decoration: line-through;
    color: var(--muted);
  }
  .chip.fixed {
    padding-right: 9px;
    background: var(--paper-2);
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .chip.cand {
    border-style: dashed;
    padding-right: 9px;
    color: var(--muted);
    background: var(--sheet);
  }
  .chip.cand:hover,
  .chip.add:hover {
    color: var(--ink);
    border-color: var(--rule-2);
  }
  .chip.add {
    border-style: dashed;
    padding-right: 9px;
    color: var(--muted);
    background: var(--sheet);
  }
  .targets {
    margin-top: 10px;
  }
  .tg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .tg-k {
    margin-right: 2px;
    font-size: var(--fs-label);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .targets.need .tg-k {
    color: var(--c-warn);
  }
  .tg-wait,
  .tg-files {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .tg-files {
    margin-left: 2px;
  }
  .chip.tg .sym {
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .chip.tg.cited {
    padding-right: 9px;
    border-color: var(--rule-2);
    background: var(--sheet);
  }
  .tg-ask {
    margin: 8px 0 4px;
    font-size: var(--fs-label);
    color: var(--text);
  }
  /* Japanese UI sentences: no 「ん。」 alone on the last line, no line starting with 。 (JLREQ) */
  .tg-ask,
  .tg-none p {
    line-break: strict;
    text-wrap: pretty;
  }
  .tg-cands {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cand-row {
    display: grid;
    grid-template-columns: 10px max-content minmax(0, 1fr) max-content;
    align-items: center;
    gap: 1px 8px;
    width: 100%;
    min-height: 32px;
    padding: 5px 8px 5px 10px;
    border: 1px dashed var(--rule-2);
    border-radius: var(--r-input);
    background: var(--sheet);
    font-size: var(--fs-label);
    color: var(--text);
    text-align: left;
  }
  .cand-row:hover,
  .cand-row:focus-visible {
    border-style: solid;
    border-color: var(--ink);
    background: var(--hover);
  }
  .cand-row .plus {
    color: var(--muted);
  }
  .cand-row .lb {
    color: var(--ink);
    white-space: nowrap;
  }
  .cand-row .sym {
    color: var(--muted);
    font-size: var(--fs-meta);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  /* second line: why it is offered and the full path (two `main.go` are not the same file) */
  .cand-row .why {
    grid-column: 2 / -1;
    color: var(--muted);
    font-size: var(--fs-meta);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cand-row kbd {
    font-size: var(--fs-meta);
  }
  .tg-none {
    margin-top: 8px;
    padding: 10px 12px;
    border-radius: var(--r-input);
    background: var(--c-warn-bg);
    font-size: var(--fs-label);
    color: var(--text);
  }
  .tg-none p {
    margin: 0;
    line-height: 1.6;
  }
  .tg-none .tg-alt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    color: var(--muted);
  }
  .disc {
    margin: 10px 0 0;
    padding: 8px 10px;
    border-radius: var(--r-input);
    background: var(--paper-2);
    font-size: var(--fs-label);
    color: var(--text);
    transition: box-shadow 0.2s;
  }
  .disc.nudge {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .gatewarn {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
  .err {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--c-bad);
  }
  .warnbox {
    margin-top: 8px;
    padding: 10px 12px;
    border-radius: var(--r-input);
    background: var(--c-warn-bg);
    color: var(--text);
    font-size: var(--fs-label);
  }
  .warnbox p {
    margin: 0 0 8px;
  }
  .warnbox .row {
    display: flex;
    gap: 8px;
  }
  .three {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 8px;
  }
  .three .k {
    margin: 0 0 2px;
    color: var(--muted);
  }
  .three pre {
    margin: 0;
    max-height: 140px;
    overflow: auto;
    padding: 6px;
    border-radius: var(--r-chip);
    background: var(--sheet);
    white-space: pre-wrap;
    font-size: var(--fs-meta);
  }
  .cm-f {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--rule-soft);
  }
  .cm-f .zero {
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .cm-f .grow {
    flex: 1;
  }
  .path {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 6px;
    border-radius: var(--r-chip-l);
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .path:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .path .pi {
    color: var(--c-run);
  }
  .send kbd {
    margin-left: 8px;
    border-color: color-mix(in srgb, var(--paper) 35%, transparent);
    background: none;
    color: inherit;
    opacity: 0.75;
  }
  .hint {
    margin: 8px 0 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
</style>
