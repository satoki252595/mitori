<!--
  S3 コード (ux.md §4.5): one file, server-highlighted, a window of ≤ 400 lines around `#L<a>-L<b>` (earlier /
  later windows on demand); right column = the doc blocks citing this file (backlinks).
-->
<script lang="ts">
import { type FileContent, HREFS, MitoriError } from "@mitori/core";
import { untrack } from "svelte";
import { errorText, t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import Rail from "../shell/Rail.svelte";
import { currentLayout, useStores } from "../stores/app.svelte.ts";
import CodePane from "./CodePane.svelte";
import { codeWindow, invalidateCode, loadCode } from "./code.ts";

const s = useStores();
const route = $derived(s.router.route);
const layout = $derived(currentLayout(s));
let content = $state.raw<FileContent | null>(null);
let error = $state<string | null>(null);
/** The open file changed on disk (SSE `index.changed`): offer a reload instead of swapping lines under the reader. */
let changed = $state(false);
let reload = $state(0);
const range = $derived(route.name === "code" ? (route.range ?? { start: 1, end: 1 }) : { start: 1, end: 1 });

$effect(() => {
  const c = s.workspace.changed;
  if (!c || route.name !== "code") return;
  const r = route;
  untrack(() => {
    invalidateCode(r.ws, c.paths);
    if (c.paths.includes(r.path)) changed = true;
  });
});

$effect(() => {
  if (route.name !== "code") return;
  void reload;
  const { ws, path } = route;
  changed = false;
  const w = codeWindow(range.start, range.end, 180);
  error = null;
  loadCode(s.api, ws, path, w.start, w.end).then(
    (c) => {
      content = c;
      markAfterPaint("mitori:section:rendered", { id: path });
      s.router.painted();
    },
    (err) => {
      const e = MitoriError.from(err);
      error = e.code === "E_DENY_GLOB" ? t("code.denied") : errorText(e.toData());
      s.router.painted();
    },
  );
});
</script>

<div class="body code-body" style:grid-template-columns="{layout.rail}px minmax(0,1fr) {layout.ctx}px">
  <Rail mode={layout.railMode} />
  <main id="main" class="code-main" tabindex="-1">
    <h1 class="sr-only">{route.name === "code" ? route.path : ""}</h1>
    {#if changed}
      <p class="changed" role="status" data-chrome>{t("code.changed")} <button type="button" class="btn btn-sec btn-s" onclick={() => reload++}>{t("code.reload")}</button></p>
    {/if}
    <CodePane {content} {range} badge={content && s.workspace.status?.snapshot?.dirty ? "uncommitted" : "exact"} {error} />
  </main>
  <aside class="backlinks" aria-label={t("code.backlinks")} data-chrome>
    <h2 class="rail-label">{t("code.backlinks")}</h2>
    {#if content && route.name === "code"}
      {#if content.outline?.length}
        <h2 class="rail-label outline-h">{t("code.outline", { n: content.outline.length })}</h2>
        <ol class="outline">
          {#each content.outline as o (`${o.name}:${o.line}`)}
            <li><a href={HREFS.code(route.ws, content.path, o.line)} class:exp={o.exported}><span class="mono" data-user-content>{o.name}</span> <span class="mono ln">L{o.line}</span></a></li>
          {/each}
        </ol>
        <h2 class="rail-label">{t("code.backlinks")}</h2>
      {/if}
      {#each content.backlinks as b (`${b.block}:${b.start}-${b.end}`)}
        <a class="bl" href={HREFS.doc(route.ws, b.section, b.block)}><span class="mono">&sect;{s.doc.index?.numbers.get(b.section) ?? b.section}</span> <span class="mono">L{b.start}&ndash;{b.end}</span></a>
      {:else}
        <p class="empty">{t("code.noBacklinks")}</p>
      {/each}
    {/if}
  </aside>
</div>

<style>
  .outline {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    max-height: 40vh;
    overflow-y: auto;
    font-size: var(--fs-meta);
  }
  .outline a {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
    color: var(--muted);
    text-decoration: none;
  }
  .outline a.exp {
    color: var(--text);
  }
  .outline a:hover {
    color: var(--ink);
  }
  .outline .ln {
    color: var(--faint);
  }
  .code-main {
    position: sticky;
    top: var(--hdr);
    height: calc(100vh - var(--hdr) - var(--status));
    min-width: 0;
  }
  .changed {
    position: absolute;
    top: 8px;
    right: 16px;
    z-index: 2;
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 0;
    padding: 6px 10px;
    border-radius: var(--r-btn);
    background: var(--c-warn-bg);
    color: var(--c-warn);
    font-size: var(--fs-label);
  }
  .backlinks {
    padding: 20px 16px;
    border-left: 1px solid var(--rule-soft);
  }
  .bl {
    display: flex;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-btn);
    font-size: var(--fs-label);
    min-height: 28px;
  }
  .bl:hover {
    background: var(--hover);
  }
  .empty {
    color: var(--muted);
    font-size: var(--fs-ui);
  }
</style>
