<!--
  What a trust decision is about (ux.md §4.12 R1, SEC-03): the kind, the FULL text that will run or be injected
  (`preview`; gates one argv per line, mono), the content hash (first 12 hex) and the factual consequence. Shared by
  the trust dialog and the Inbox detail. The preview region takes the initial focus (neither button does).
-->
<script lang="ts">
import type { TrustRequest } from "@mitori/core";
import { t } from "../shell/index.ts";

let { request, focusPreview = false }: { request: TrustRequest; focusPreview?: boolean } = $props();
let pre: HTMLElement | undefined = $state();
$effect(() => {
  if (focusPreview) pre?.focus({ preventScroll: true });
});
</script>

<p class="kind">{t(`trust.kind.${request.item}`)}</p>
<!-- svelte-ignore a11y_no_noninteractive_tabindex (the preview is the initial focus: read before deciding) -->
<pre class="pv mono" tabindex="0" bind:this={pre} aria-label={t("trust.preview")} data-user-content>{request.preview}</pre>
<p class="hash mono">{t("trust.hash", { hash: request.hash.slice(0, 12) })}</p>
<p class="why">{t(`trust.why.${request.item}`)}</p>
<p class="again">{t("trust.again")}</p>

<style>
  .kind {
    margin: 0 0 6px;
    font-size: var(--fs-label);
    color: var(--muted);
    letter-spacing: var(--ls-caps);
  }
  .pv {
    margin: 0;
    max-height: 240px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid var(--rule);
    border-radius: var(--r-input);
    background: var(--paper-2);
    color: var(--ink);
    font-size: var(--fs-label);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .pv:focus-visible {
    outline: var(--focus-w) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .hash {
    margin: 6px 0 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .why {
    margin: 12px 0 0;
    font-size: var(--fs-ui);
    color: var(--text);
    line-height: 1.7;
  }
  .again {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
</style>
