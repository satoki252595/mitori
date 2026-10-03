<!--
  Right column of the export: 「この節について」 (the app's empty-margin card): reading time, blocks, trust counts and the
  files the page cites — a cited file opens its embedded excerpt. No threads, composer or code pane (read-only file).
-->
<script lang="ts" module>
import type { LineNo, RepoPath } from "@mitori/core";

export interface About {
  minutes: number;
  blocks: number;
  verified: number;
  inferred: number;
  stale: number;
  staticOnly: boolean;
  files: readonly { path: RepoPath; n: number; start: LineNo; end: LineNo; cite: string; blob: string }[];
}
</script>

<script lang="ts">
import { t } from "../shell/index.ts";
import { useViewer } from "./state.svelte.ts";

let { about, onfile }: { about: About; onfile: (f: About["files"][number], el: HTMLElement) => void } = $props();
const v = useViewer();
const FILES_SHOWN = 8;
const column = $derived(v.width >= 1024);
</script>

{#if column}
  <aside class="ctx" data-mode="margin" data-place="column" aria-label={t("ctx.about.title")}>
    <div class="margin-empty" data-chrome>
      <section class="about" aria-labelledby="about-t">
        <h2 id="about-t" class="rail-label">{t("ctx.about.title")}</h2>
        <dl class="stats">
          <div><dt>{t("ctx.about.read")}</dt><dd>{t("reader.meta.minutes", { n: about.minutes })}</dd></div>
          <div><dt>{t("ctx.about.blocks")}</dt><dd class="mono">{about.blocks}</dd></div>
          <div><dt>{t("ctx.about.cites")}</dt><dd class="mono">{about.files.reduce((n, f) => n + f.n, 0)}</dd></div>
          <div>
            <dt>{t("ctx.about.trust")}</dt>
            <dd>
              {#if about.staticOnly}{t("ctx.about.static")}{:else}{t("ctx.about.claims", { v: about.verified, i: about.inferred })}{#if about.stale > 0}<span class="warn"> &middot; {t("reader.meta.stale", { n: about.stale })}</span>{/if}{/if}
            </dd>
          </div>
        </dl>
        {#if about.files.length}
          <h3 class="rail-label">{t("ctx.about.files")}</h3>
          <ul class="files">
            {#each about.files.slice(0, FILES_SHOWN) as f (f.path)}
              <li>
                <button type="button" onclick={(e) => onfile(f, e.currentTarget)}>
                  <span class="p mono" data-user-content>{f.path}</span><span class="n mono">{f.n}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if about.files.length > FILES_SHOWN}<p class="more">{t("ctx.about.more", { n: about.files.length - FILES_SHOWN })}</p>{/if}
        {/if}
      </section>
      <p class="hint">{t("export.hint.readonly")}</p>
    </div>
  </aside>
{/if}

<style>
  .ctx {
    position: relative;
    min-width: 0;
    border-left: 1px solid var(--rule-soft);
  }
  .margin-empty {
    position: sticky;
    top: var(--hdr);
    padding: 28px 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-height: calc(100vh - var(--hdr));
    overflow: auto;
    scrollbar-width: thin;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-label);
    line-height: 1.7;
  }
  .about {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .about h3 {
    margin-top: 10px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
  }
  .stats div {
    padding: 8px 12px;
    min-width: 0;
  }
  .stats div:nth-child(even) {
    border-left: 1px solid var(--rule-soft);
  }
  .stats div:nth-child(n + 3) {
    border-top: 1px solid var(--rule-soft);
  }
  .stats dt {
    font-size: var(--fs-meta);
    color: var(--muted);
  }
  .stats dd {
    margin: 2px 0 0;
    font-size: var(--fs-ui);
    color: var(--ink);
  }
  .warn {
    color: var(--c-warn);
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .files button {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    min-height: 30px;
    padding: 4px 8px;
    margin: 0 -8px;
    border-radius: var(--r-btn);
    text-align: left;
    font-size: var(--fs-label);
    color: var(--text);
  }
  .files button:hover,
  .files button:focus-visible {
    background: var(--hover);
  }
  .files .p {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .files .n {
    flex: none;
    color: var(--muted);
  }
  .more {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--muted);
  }
</style>
