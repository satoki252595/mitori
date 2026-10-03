<!--
  Server-rendered HTML (message bodies `MessageView.html` — markdown-it with raw HTML disabled and secrets redacted,
  CR m1-70 / ux-R23 — and proposal `diffHtml`). The ONLY place in the loop UI that inserts HTML strings from the
  server; the client never parses Markdown. Until the HTML arrives, `fallback` is shown as plain text.
-->
<script lang="ts">
let { html, fallback = "", cls = "" }: { html: string | null; fallback?: string; cls?: string } = $props();
</script>

{#if html}
  <div class="srv prose-s {cls}" data-user-content>{@html html}</div>
{:else}
  <div class="srv plain {cls}" data-user-content>{fallback}</div>
{/if}

<style>
  .srv {
    font-size: var(--fs-ui);
    line-height: 1.75;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .srv.plain {
    white-space: pre-wrap;
  }
  .srv :global(p) {
    margin: 0 0 6px;
  }
  .srv :global(p:last-child) {
    margin-bottom: 0;
  }
  .srv :global(code) {
    font-family: var(--font-mono);
    font-size: var(--code-font-scale);
    padding: 1px 4px;
    border-radius: var(--r-chip);
    background: var(--code-bg);
  }
  .srv :global(ul),
  .srv :global(ol) {
    margin: 4px 0;
    padding-left: 1.3em;
  }
  .srv :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
  }
  .srv :global(del.d) {
    color: var(--del-fg);
    background: var(--del-bg);
    text-decoration-thickness: 1.5px;
  }
  .srv :global(ins.a) {
    color: var(--add-fg);
    background: var(--add-bg);
    text-decoration: underline;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
  }
</style>
