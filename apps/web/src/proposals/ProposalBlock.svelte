<!--
  Proposal block (contract `ProposalBlockProps`, ux.md §6.5, prototype 03d/03e): shown IN the prose in place of the
  block it would change — `--sugg-bg` surface, left 2px `--c-prop`, header 「提案 · mitori AI（model）· R{n} · 本文」 and
  ✓ / ✕ (28×28, aria-label), body = the server's word-level `diffHtml` (`del.d` / `ins.a`).
-->
<script lang="ts">
import type { ProposalBlockProps } from "../contract.ts";
import { decorateTable } from "../reader/decorate.ts";
import { t } from "../shell/index.ts";
import ServerHtml from "../threads/ServerHtml.svelte";

type CodeHref = (path: string, start: number, end: number) => string | null;
let {
  proposal,
  producer,
  ondecide,
  decided = null,
  codeHref = null,
}: ProposalBlockProps & { decided?: "accept" | "reject" | null; codeHref?: CodeHref | null } = $props();

let body = $state<HTMLElement>();
// the proposed table reads like the block it replaces: the same column classes and, in a facts table, the same
// `config.go:25` cite chips (the reader decorates the block's own tables the same way — reader/decorate.ts)
$effect(() => {
  void proposal.diffHtml;
  void proposal.html;
  if (!body) return;
  for (const table of body.querySelectorAll<HTMLTableElement>("table")) decorateTable(table, codeHref);
});
</script>

<div class="pp" data-decided={decided} data-mx="prop-body" data-chrome>
  <header class="pp-h">
    <svg class="i" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3-7.5 7.5H3v-3Z" /></svg>
    <span class="pr">{producer}</span>
    {#if decided}<span class="dd">{decided === "accept" ? t("proposals.willAccept") : t("proposals.willReject")}</span>{/if}
    <span class="acts">
      <button type="button" class="ok" class:on={decided === "accept"} aria-label={t("proposals.accept")} onclick={() => ondecide("accept")}>✓<span>{t("proposals.acceptShort")}</span></button>
      <button type="button" class="no" class:on={decided === "reject"} aria-label={t("proposals.reject")} onclick={() => ondecide("reject")}>✕</button>
    </span>
  </header>
  {#if proposal.op === "delete"}<p class="del">{t("proposals.delete")}</p>{/if}
  <div bind:this={body}><ServerHtml html={proposal.diffHtml || proposal.html} cls="pp-b" /></div>
  {#if proposal.conflict}<p class="warn">{t("proposals.conflict")}</p>{/if}
  {#if proposal.externalLinks}<p class="warn">{t("proposals.links", { n: proposal.externalLinks })}</p>{/if}
</div>

<style>
  .pp {
    position: relative;
    margin: 4px -14px;
    padding: 12px 18px 14px;
    border-radius: var(--r-card);
    background: var(--sugg-bg);
    box-shadow: inset 2px 0 0 var(--c-prop);
  }
  .pp[data-decided="reject"] :global(.pp-b) {
    opacity: 0.55;
  }
  .pp-h {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-family: var(--font-ui);
    font-size: var(--fs-label);
    font-weight: var(--fw-strong);
    color: var(--c-prop);
  }
  .pp-h .i {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
  }
  .pp-h .dd {
    font-weight: var(--fw-regular);
    color: var(--muted);
  }
  .acts {
    display: inline-flex;
    gap: 6px;
    margin-left: auto;
  }
  .acts button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 28px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--rule-2);
    border-radius: var(--r-btn);
    background: var(--sheet);
    color: var(--c-prop);
    font-weight: var(--fw-strong);
  }
  .acts button.no {
    padding: 0;
    color: var(--muted);
  }
  .acts button.on.ok {
    background: var(--c-ok-bg);
    color: var(--c-ok);
    border-color: var(--c-ok);
  }
  .acts button.on.no {
    background: var(--c-bad-bg);
    color: var(--c-bad);
    border-color: var(--c-bad);
  }
  .pp :global(.pp-b) {
    font-family: var(--font-prose);
    font-size: var(--fs-body);
    line-height: var(--lh-prose);
    letter-spacing: var(--ls-prose);
    color: var(--text);
  }
  /* a table stays inside the card (the reader's full-bleed table would touch the card's edge) */
  .pp :global(.pp-b table) {
    width: 100%;
    margin: 6px 0 0;
  }
  .pp :global(.pp-b) {
    line-break: strict;
    text-wrap: pretty;
  }
  /* a cite link (`fetch.go:46-61`) is one unit, as the block's cite chip is: never 「fetch.go:45-」 / 「60」 */
  .pp :global(.pp-b a[href*="#L"]) {
    white-space: nowrap;
  }
  /* a facts cite chip looks like the block's own (prose.css `.fcite`), not like a message's code span */
  .pp :global(.pp-b .fcite) {
    text-decoration: none;
  }
  .pp :global(.pp-b .fcite code) {
    border: 1px solid var(--rule);
    background: var(--sheet);
    color: var(--muted);
  }
  /* suggestion mode (prototype 03d/03e): struck old words, underlined new ones */
  .pp :global(del.d) {
    color: var(--del-fg);
    text-decoration: line-through;
    text-decoration-thickness: 1.5px;
    background: var(--del-bg);
    border-radius: 3px;
  }
  .pp :global(ins.a) {
    color: var(--add-fg);
    text-decoration: underline;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    background: var(--add-bg);
    border-radius: 3px;
  }
  .del,
  .warn {
    margin: 6px 0 0;
    font-family: var(--font-ui);
    font-size: var(--fs-label);
    color: var(--c-warn);
  }
</style>
