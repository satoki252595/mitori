<!--
  Thread card (contract `ThreadCardProps`, ux.md §6.3, prototype 03f / 04): header `{who} · {意図} · {時刻}` + the
  status pill, the quote (2 lines, left rule), the message bodies (server HTML `MessageView.html`; plain text until it
  arrives — the client never parses Markdown), the footer `R{n} · 費用 · 返信数` and the actions (返信 / 解決 /
  文書に追記 / 決定事項にする / 再オープン). `collapsed` is the 32 px one-liner of the X14 rule. Applied threads show
  the post-accept line (取り消し点 · コミットする · 差分をコピー, UXP-19).
-->
<script lang="ts">
import type { JobSummary, ThreadSummary } from "@mitori/core";
import { fmtUsd, isComposing, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { threadStatus } from "./index.ts";
import { loopOf } from "./loop.svelte.ts";
import ServerHtml from "./ServerHtml.svelte";
import StatusPill from "./StatusPill.svelte";

let {
  thread,
  collapsed,
  active,
  showIds,
  job = null,
  onexpand = () => {},
}: { thread: ThreadSummary; collapsed: boolean; active: boolean; showIds: boolean; job?: JobSummary | null; onexpand?: () => void } = $props();

const s = useStores();
const loop = loopOf(s);
const status = $derived(threadStatus(thread));
const msgs = $derived(loop.messages.get(thread.id) ?? []);
const quote = $derived(thread.anchor.doc?.quote?.exact ?? "");
const first = $derived(msgs[0]);
const rest = $derived(msgs.slice(1));
let replying = $state(false);
let reply = $state("");
let busy = $state(false);
const ck = $derived(job?.checkpoint ? loop.checkpoints.get(job.checkpoint) : undefined);
const applied = $derived(thread.state === "applied" || job?.state === "accepted" || job?.state === "partially_accepted");
const expert = $derived(s.doc.level === "expert");

$effect(() => {
  // messages are fetched once a card is expanded (SSE appends afterwards)
  if (!collapsed && !loop.messages.has(thread.id) && !thread.id.startsWith("tmp_")) void loop.loadThread(thread.id);
});

function ago(iso: string): string {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 60) return t("threads.time.now");
  if (d < 3600) return t("threads.time.min", { n: Math.floor(d / 60) });
  if (d < 86400) return t("threads.time.hour", { n: Math.floor(d / 3600) });
  return t("threads.time.day", { n: Math.floor(d / 86400) });
}

function who(by: string): string {
  if (by === "human") return t("threads.who.you");
  if (by === "system") return t("threads.who.system");
  return by.startsWith("agent:") ? t("threads.who.agent", { name: by.slice(6) }) : by;
}

async function send() {
  if (!reply.trim() || busy) return;
  busy = true;
  const viaTransition = thread.state === "needs_input" || thread.state === "answered" || thread.state === "rejected" || thread.state === "failed";
  const ok = viaTransition ? await loop.transition(thread.id, "reply", { message: reply }) : await loop.reply(thread.id, reply);
  busy = false;
  if (ok) {
    reply = "";
    replying = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (isComposing(e)) return;
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void send();
  } else if (e.key === "Escape") {
    e.stopPropagation();
    replying = false;
  }
}
</script>

{#if collapsed}
  <button type="button" class="tc-1" data-status={status} onclick={onexpand} aria-label={t("threads.card.expand", { status: t(`status.${status}`), quote: quote.slice(0, 40) })} data-chrome>
    <StatusPill {status} glyphOnly />
    <span class="st">{t(`status.${status}`)}</span><span class="sep" aria-hidden="true">·</span><span class="qq" data-user-content>{quote.slice(0, 16)}</span>
  </button>
{:else}
  <article class="card tc" class:active data-status={status} aria-label={t("threads.card.label", { intent: t(`composer.intent.${thread.intent}`) })} data-chrome>
    <header class="tc-h">
      <b>{t(`composer.intent.${thread.intent}`)}</b>
      {#if applied || thread.round > 1}<span class="mono r">R{thread.round}</span>{/if}
      {#if showIds}<span class="mono id">{thread.id}</span>{/if}
      <span class="time">{ago(thread.updatedAt)}</span>
      <span class="pill">
        {#if applied}<StatusPill status="applied" label={t("threads.resolvedIn", { n: thread.round })} />{:else}<StatusPill {status} />{/if}
      </span>
    </header>
    {#if quote}<p class="q" data-user-content>{quote}</p>{/if}
    {#if status === "outdated"}<p class="note warn">{t("threads.outdated")}</p>{/if}
    {#if status === "stale"}<p class="note warn">{t("threads.stale")}</p>{/if}
    <div class="msgs">
      {#if first}
        <ServerHtml html={first.html} fallback={first.body} />
      {:else}
        <ServerHtml html={null} fallback={thread.preview} />
      {/if}
      {#each rest as m (m.id)}
        <div class="m" data-by={m.by.startsWith("agent") ? "agent" : m.by}>
          <p class="mw"><b>{who(m.by)}</b>{#if m.kind !== "comment"}<span class="k"> · {t(`threads.kind.${m.kind}`)}</span>{/if}</p>
          <ServerHtml html={m.html} fallback={m.body} />
          {#each (m.cites ?? []).filter((c) => !c.exists) as c (`${c.path}:${c.start}`)}
            <p class="note warn mono">⚠ {c.path}:{c.start}-{c.end} · {t("threads.citeMissing")}</p>
          {/each}
        </div>
      {/each}
    </div>
    {#if applied}
      <p class="after mono">
        {t("threads.applied")}{#if ck && expert} · {t("threads.checkpoint", { ref: ck.ref })}{:else if ck && !ck.commit} · {t("threads.uncommitted")}{/if}
      </p>
      {#if job?.usage}<p class="after mono">{fmtUsd(job.usage.apiUsd, "job")}{#if job.timings} · {t("jobs.took", { s: (job.timings.wallMs / 1000).toFixed(1) })}{/if}</p>{/if}
    {/if}
    {#if replying}
      <textarea class="reply" bind:value={reply} onkeydown={onKey} aria-label={t("threads.reply.label")} placeholder={t("threads.reply.placeholder")}></textarea>
    {/if}
    <footer class="tc-f">
      {#if thread.messages > 1}<span class="mono n">{t("threads.replies", { n: thread.messages - 1 })}</span>{/if}
      <span class="grow"></span>
      {#if replying}
        <button type="button" class="btn btn-pri btn-s" disabled={!reply.trim() || busy} onclick={() => void send()}>{t("threads.reply.send")}<kbd>{s.keys.label("Mod+Enter")}</kbd></button>
      {:else if applied && job}
        <button type="button" class="btn btn-gh" onclick={() => void loop.undo.undo()} disabled={!loop.undo.last}>{t("review.action.undo")}</button>
        <button type="button" class="btn btn-gh" onclick={() => void loop.copyDiff(job.id)}>{t("threads.copyDiff")}</button>
        {#if ck && !ck.commit}<button type="button" class="btn btn-sec btn-s" onclick={() => void loop.commit(job.id)}>{t("threads.commit")}</button>{/if}
      {:else if thread.state === "resolved"}
        <button type="button" class="btn btn-gh" onclick={() => void loop.transition(thread.id, "reopen")}>{t("threads.reopen")}</button>
      {:else}
        {#if thread.state === "answered"}
          <button type="button" class="btn btn-gh" onclick={() => void loop.promote(thread.id, "doc")}>{t("threads.promoteDoc")}</button>
          <button type="button" class="btn btn-gh" onclick={() => void loop.promote(thread.id, "decision")}>{t("threads.promoteDecision")}</button>
        {/if}
        {#if thread.intent === "note" && thread.state === "open"}
          <label class="ai"><input type="checkbox" checked={!!thread.sendToAi} onchange={(e) => void loop.setSendToAi(thread.id, (e.currentTarget as HTMLInputElement).checked)} />{t("threads.sendToAi")}</label>
        {/if}
        <button type="button" class="btn btn-gh" onclick={() => (replying = true)}>{t("threads.reply")}</button>
        {#if ["open", "answered", "rejected", "failed", "needs_input"].includes(thread.state)}
          <button type="button" class="btn btn-gh" onclick={() => void loop.transition(thread.id, "resolve", { resolution: thread.state === "answered" ? "answered" : "wontfix" })}>{t("threads.resolve")}</button>
        {/if}
      {/if}
    </footer>
  </article>
{/if}

<style>
  .tc {
    padding: 12px 16px 10px;
    box-shadow: var(--shadow-soft);
    font-size: var(--fs-ui);
  }
  .tc.active {
    box-shadow: var(--shadow-pop);
    border-color: var(--rule-2);
  }
  .tc-h {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .tc-h b {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .tc-h .id {
    font-size: var(--fs-meta);
  }
  .tc-h .time {
    font-size: var(--fs-meta);
  }
  .tc-h .pill {
    margin-left: auto;
  }
  .q {
    margin: 8px 0 0;
    padding-left: 10px;
    border-left: 2px solid var(--mark);
    color: var(--muted);
    font-size: var(--fs-label);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .msgs {
    margin-top: 8px;
    color: var(--ink);
  }
  .m {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--rule-soft);
  }
  .m .mw {
    margin: 0 0 2px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .m .mw b {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .note {
    margin: 6px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .note.warn {
    color: var(--c-warn);
  }
  .after {
    margin: 8px 0 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .reply {
    display: block;
    width: 100%;
    margin-top: 8px;
    min-height: 54px;
    field-sizing: content;
    max-height: 200px;
    padding: 8px 10px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-input);
    background: var(--sheet);
    color: var(--ink);
    font: inherit;
    font-size: var(--fs-ui);
    resize: none;
  }
  .tc-f {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .tc-f .n {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .tc-f .grow {
    flex: 1;
  }
  .tc-f kbd {
    margin-left: 6px;
    background: none;
    color: inherit;
  }
  .ai {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-label);
    color: var(--muted);
    margin-right: 4px;
  }
  .tc-1 {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    font-size: var(--fs-label);
    color: var(--muted);
    text-align: left;
  }
  .tc-1:hover {
    border-color: var(--rule-2);
    color: var(--ink);
  }
  .tc-1 .st {
    color: var(--ink);
  }
  .tc-1 .qq {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
