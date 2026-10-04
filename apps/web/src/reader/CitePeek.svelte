<!--
  Cite peek (contract `CitePeekProps`, ux.md §4.3.6): adjacent to the chip (below, above when there is no room),
  560 px, ≤ 26 body lines with the cited range marked, header path:a–b · symbol · precision · blob7, footer with
  the per-check verdicts (L0 / L1 / L2, UXP-06) and `o` pin / ⇧O editor. Does not take focus (role tooltip-like),
  stays open while the pointer travels into it (WCAG 1.4.13). In the app (not the export) the footer also carries the
  paragraph's human check (EX-10): having read the code, 「✓✓ 確かめた」 marks the paragraph's claims human-verified.
-->
<script lang="ts">
import type { CitePeek as CitePeekData, ClaimChecks } from "@mitori/core";
import { onMount } from "svelte";
import { t } from "../shell/index.ts";
import { followAnchor, popoverPos } from "./popover.ts";

let {
  data,
  checks,
  precision,
  anchorEl,
  onpin,
  oneditor,
  onenter,
  onleave,
  verify = null,
  onverify,
}: {
  data: CitePeekData;
  checks: Pick<ClaimChecks, "l0" | "l1" | "l2"> | null;
  precision: "exact" | "search";
  anchorEl: HTMLElement;
  onpin: () => void;
  oneditor: () => void;
  onenter: () => void;
  onleave: () => void;
  /** The cited paragraph's human check: null = not offered (export, no claims). */
  verify?: { verified: boolean; n: number; busy: boolean } | null;
  onverify?: (next: boolean) => void;
} = $props();

let el: HTMLDivElement | undefined = $state();
let body: HTMLPreElement | undefined = $state();
let pos = $state<{ left: number; top: number; maxH: number | null }>({ left: 0, top: 0, maxH: null });

function place() {
  if (!el) return;
  // natural height (the max-height of a previous placement must not shrink the measurement)
  const h = el.scrollHeight;
  pos = popoverPos(anchorEl.getBoundingClientRect(), Math.min(560, window.innerWidth - 32), h, window.innerWidth, window.innerHeight);
}

onMount(() => {
  const stop = followAnchor(place, body);
  if (body) {
    for (const ln of body.querySelectorAll<HTMLElement>("[data-line]")) {
      const n = Number(ln.dataset.line);
      if (n >= data.start && n <= data.end) ln.classList.add("hi");
    }
    const first = body.querySelector<HTMLElement>(".hi");
    if (first) body.scrollTop = Math.max(0, first.offsetTop - 40);
  }
  return stop;
});

const l1Text = $derived(
  checks ? (checks.l1 === "pass" ? t("cite.check.l1Pass") : checks.l1 === "vacuous" ? t("cite.check.l1Vacuous") : t("cite.check.l1Fail")) : "",
);
</script>

<div
  class="pop peek"
  bind:this={el}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:max-height={pos.maxH === null ? undefined : `${pos.maxH}px`}
  role="group"
  aria-label={t("cite.peekLabel", { path: data.path, a: data.start, b: data.end })}
  onpointerenter={onenter}
  onpointerleave={onleave}
  data-chrome
>
  <div class="peek-h">
    <span class="p mono" data-user-content>{data.path}:{data.start}&ndash;{data.end}</span>
    <span class="m mono">{#if data.symbol}<span data-user-content>{data.symbol.split("#")[1]}</span> &middot; {/if}{t(precision === "exact" ? "cite.exact" : "cite.search")} &middot; {data.blob.slice(0, 7)}</span>
  </div>
  {#if data.stale}<p class="stale">&#x26A0;&#xFE0E; {t("cite.stale", { blob: data.currentBlob.slice(0, 7) })}</p>{/if}
  <pre class="mcode shiki peek-code" bind:this={body} data-user-content>{@html data.html}</pre>
  <div class="peek-f">
    {#if checks}
      <span class="chk">
        <span class:bad={!checks.l0}>{t(checks.l0 ? "cite.check.l0Pass" : "cite.check.l0Fail")}</span> &middot; <span class:bad={checks.l1 === "fail"}>{l1Text}</span> &middot;
        <span class:bad={!checks.l2}>{t(checks.l2 ? "cite.check.l2Pass" : "cite.check.l2Fail")}</span>
      </span>
    {:else}<span></span>{/if}
    <span class="keys">
      {#if verify}
        <button
          type="button"
          class="ver"
          class:on={verify.verified}
          disabled={verify.busy}
          title={t(verify.verified ? "cite.unverifyHint" : "cite.verifyHint", { n: verify.n })}
          onclick={() => onverify?.(!verify.verified)}>&#x2713;&#x2713; {t(verify.verified ? "cite.verified" : "cite.verify")}</button
        >
      {/if}
      <button type="button" onclick={onpin}><kbd>o</kbd> {t("cite.pin")}</button>
      <button type="button" onclick={oneditor}><kbd>&#x21E7;O</kbd> {t("cite.editor")}</button>
    </span>
  </div>
</div>

<style>
  .peek {
    width: var(--peek-w);
    max-width: calc(100% - 32px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .peek-h {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--rule);
    background: var(--paper);
  }
  /* the header keeps the whole path:range and gives up the symbol / precision / blob part first */
  .p {
    flex: none;
    max-width: calc(100% - 5em);
    font-size: var(--fs-label);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
  }
  .stale {
    margin: 0;
    padding: 6px 12px;
    font-size: var(--fs-label);
    color: var(--c-warn);
    background: var(--c-warn-bg);
  }
  .peek-code {
    margin: 0;
    padding: 6px 0;
    font: 0.71875rem / var(--lh-code) var(--font-mono);
    max-height: calc(26 * 0.71875rem * 1.62 + 12px);
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    background: var(--sheet);
    color: var(--shiki-foreground);
    font-variant-ligatures: none;
  }
  /* the server HTML is `<span data-line>…</span>\n` per line: lines are blocks, so the newlines between them are not rows */
  .peek-code {
    white-space: normal;
    tab-size: 4;
  }
  .peek-code :global([data-line]) {
    display: block;
    min-height: 1lh;
    padding: 0 16px 0 0;
    white-space: pre;
  }
  /* a line-number gutter: the peek is read without the file next to it — the numbers are how a reader says 「:182 の行」 */
  .peek-code :global([data-line])::before {
    content: attr(data-line);
    display: inline-block;
    box-sizing: content-box;
    width: 5ch;
    padding: 0 12px 0 4px;
    text-align: right;
    color: var(--faint);
    user-select: none;
  }
  .peek-code :global([data-line].hi) {
    background: var(--mark-line);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .peek-code :global([data-line].hi)::before {
    color: var(--muted);
  }
  .peek-f {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border-top: 1px solid var(--rule);
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .chk .bad {
    color: var(--c-warn);
  }
  .keys {
    display: flex;
    gap: 10px;
  }
  .keys button {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    min-height: 24px;
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .keys button:hover {
    color: var(--ink);
  }
  .keys .ver {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .keys .ver.on {
    color: var(--v-human);
  }
</style>
