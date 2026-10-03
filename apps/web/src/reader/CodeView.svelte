<!--
  S3 コード (ux.md §4.5): one file, server-highlighted, a window of ≤ 400 lines around `#L<a>-L<b>` (earlier /
  later windows on demand); right column = the doc blocks citing this file (backlinks).
-->
<script lang="ts">
import { type FileContent, HREFS, MitoriError } from "@mitori/core";
import { errorText, t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import Rail from "../shell/Rail.svelte";
import { currentLayout, useStores } from "../stores/app.svelte.ts";
import CodePane from "./CodePane.svelte";
import { codeWindow, loadCode } from "./code.ts";

const s = useStores();
const route = $derived(s.router.route);
const layout = $derived(currentLayout(s));
let content = $state.raw<FileContent | null>(null);
let error = $state<string | null>(null);
const range = $derived(route.name === "code" ? (route.range ?? { start: 1, end: 1 }) : { start: 1, end: 1 });

$effect(() => {
  if (route.name !== "code") return;
  const { ws, path } = route;
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
    <CodePane {content} {range} badge={content && s.workspace.status?.snapshot?.dirty ? "uncommitted" : "exact"} {error} />
  </main>
  <aside class="backlinks" aria-label={t("code.backlinks")} data-chrome>
    <h2 class="rail-label">{t("code.backlinks")}</h2>
    {#if content && route.name === "code"}
      {#each content.backlinks as b (b.block)}
        <a class="bl" href={HREFS.doc(route.ws, b.section, b.block)}><span class="mono">&sect;{s.doc.index?.numbers.get(b.section) ?? b.section}</span> <span class="mono">L{b.start}&ndash;{b.end}</span></a>
      {:else}
        <p class="empty">{t("code.noBacklinks")}</p>
      {/each}
    {/if}
  </aside>
</div>

<style>
  .code-main {
    position: sticky;
    top: var(--hdr);
    height: calc(100vh - var(--hdr) - var(--status));
    min-width: 0;
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
