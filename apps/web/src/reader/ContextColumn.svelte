<!--
  Context column (contract `ContextColumnStore` modes, ux.md §4.4): margin (thread cards / Composer / job cards —
  the loop UI of WP-10b plugs in through `UiExtension.margin`), code (CodePane, pinned or scrollspy-driven), review
  (640 px or right overlay; `UiExtension.reviewPanel`). Placement (column / overlay / bottom sheet) comes from
  the container-width layout (UXP-03).
-->
<script lang="ts">
import type { JobId, LineNo, RepoPath, SectionId } from "@mitori/core";
import { type Component, untrack } from "svelte";
import { t } from "../shell/index.ts";
import { markAfterPaint } from "../shell/perf.ts";
import Rich from "../shell/Rich.svelte";
import { useStores } from "../stores/app.svelte.ts";

let CodeColumn = $state.raw<typeof import("./ContextCode.svelte").default | null>(null);
let codeLoading: Promise<unknown> | null = null;

import { invalidateCode } from "./code.ts";

let {
  placement,
  width,
  page,
  spy,
  margin,
  review,
  about = null,
  onwidth,
}: {
  placement: "column" | "overlay" | "sheet" | "none";
  width: number;
  page: SectionId;
  spy: { path: RepoPath; start: LineNo; end: LineNo; blob?: string } | null;
  margin: Component<{ page: string }> | null;
  review: Component<{ job: JobId }> | null;
  /** 「この節について」 of the empty margin (no loop UI yet / no threads): stats and the files the page cites. */
  about?: {
    minutes: number;
    blocks: number;
    verified: number;
    inferred: number;
    stale: number;
    staticOnly: boolean;
    files: readonly { path: RepoPath; n: number; start: LineNo; end: LineNo }[];
  } | null;
  onwidth: (px: number) => void;
} = $props();

const FILES_SHOWN = 8;
/** A cited file opens in code mode, pinned to its first cited range (same as `o` on a chip). */
function pin(f: { path: RepoPath; start: LineNo; end: LineNo }) {
  const p = { path: f.path, start: f.start, end: f.end };
  s.ctx.set("code", { pin: p });
  const r = s.router.route;
  if (r.name === "doc") s.router.replaceUrl({ ...r, ctx: "code", pin: p });
}

const s = useStores();
const mode = $derived(s.ctx.mode);
// The margin's source list does not need the code viewer until a cite is pinned or code mode is opened.
$effect(() => {
  if (mode === "code") codeLoading ??= import("./ContextCode.svelte").then((m) => (CodeColumn = m.default));
});

$effect(() => {
  markAfterPaint("mitori:ctx:mode", { mode });
});

// Cached windows must be invalidated even while the code column is closed.
let rev = $state(0);
$effect(() => {
  const ch = s.workspace.changed;
  const ws = s.workspace.key;
  if (!ch || !ws) return;
  untrack(() => {
    const target = s.ctx.pin ?? spy;
    if (invalidateCode(ws, ch.paths) && target && ch.paths.includes(target.path)) rev++;
  });
});
</script>

<!-- The grid owns column width, including its transition; an immediate fixed width overflows the moving track. -->
<aside class="ctx" data-mode={mode} data-place={placement} aria-label={t(`ctx.${mode}`)}>
  {#if mode === "code"}
    {#if CodeColumn}<CodeColumn {placement} {width} {spy} {rev} {onwidth} />{:else}<p class="empty">{t("ctx.codeEmpty")}</p>{/if}
  {:else if mode === "review"}
    {#if review && s.ctx.job}
      {@const Review = review}
      <Review job={s.ctx.job} />
    {:else}
      <div class="review-ph" data-chrome>
        <p class="t">{t("ctx.reviewTitle")}</p>
        <p>{t("ctx.reviewPending")}</p>
      </div>
    {/if}
  {:else if margin}
    {@const Margin = margin}
    <!-- the loop UI renders nothing on a page without threads / an open Composer: the empty margin (「この節について」)
         then stays — it no longer flashes until the loop chunk arrives and vanishes (display: contents: the cards lay
         out as children of the column, as before) -->
    <div class="margin-host"><Margin {page} /></div>
    {@render emptyMargin()}
  {:else}
    {@render emptyMargin()}
  {/if}
</aside>

{#snippet emptyMargin()}
  <div class="margin-empty" data-chrome>
    <!-- the tip first: the stats / cited files below arrive with the page and grow downward (CLS 0) -->
    <p class="hint"><Rich text={t("ctx.marginEmpty")} /></p>
    {#if about}
      <section class="about" aria-labelledby="about-t">
        <h2 id="about-t" class="rail-label">{t("ctx.about.title")}</h2>
        <dl class="stats">
          <div><dt>{t("ctx.about.read")}</dt><dd>{t("reader.meta.minutes", { n: about.minutes })}</dd></div>
          <div><dt>{t("ctx.about.blocks")}</dt><dd class="mono">{about.blocks}</dd></div>
          <div><dt>{t("ctx.about.cites")}</dt><dd class="mono">{about.files.reduce((n, f) => n + f.n, 0)}</dd></div>
          <div>
            <dt>{t("ctx.about.trust")}</dt>
            <dd>{#if about.staticOnly}{t("ctx.about.static")}{:else}{t("ctx.about.claims", { v: about.verified, i: about.inferred })}{#if about.stale > 0}<span class="warn"> &middot; {t("reader.meta.stale", { n: about.stale })}</span>{/if}{/if}</dd>
          </div>
        </dl>
        {#if about.files.length}
          <h3 class="rail-label">{t("ctx.about.files")}</h3>
          <ul class="files">
            {#each about.files.slice(0, FILES_SHOWN) as f (f.path)}
              <li>
                <button type="button" onclick={() => pin(f)} title={t("ctx.about.pin")}>
                  <span class="p mono" data-user-content>{f.path}</span><span class="n mono">{f.n}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if about.files.length > FILES_SHOWN}<p class="more">{t("ctx.about.more", { n: about.files.length - FILES_SHOWN })}</p>{/if}
        {/if}
      </section>
    {/if}
  </div>
{/snippet}

<style>
  .ctx {
    position: relative;
    min-width: 0;
    border-left: 1px solid var(--rule-soft);
  }
  .ctx[data-mode="code"][data-place="column"],
  .ctx[data-mode="review"][data-place="column"] {
    position: sticky;
    top: var(--hdr);
    height: calc(100vh - var(--hdr) - var(--status));
    align-self: start;
  }
  .ctx[data-place="overlay"] {
    position: fixed;
    right: 0;
    top: var(--hdr);
    bottom: var(--status);
    width: min(640px, calc(100% - 48px));
    z-index: var(--z-overlay);
    background: var(--paper);
    box-shadow: var(--shadow-pop);
  }
  .ctx[data-place="sheet"] {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--status);
    height: var(--sheet-half);
    z-index: var(--z-sheet);
    background: var(--paper);
    border-top: 1px solid var(--rule);
    border-left: 0;
    border-radius: 14px 14px 0 0;
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .ctx[data-place="sheet"][data-mode="margin"] {
    display: none;
  }
  .empty { padding: 24px 22px; color: var(--muted); font-size: var(--fs-ui); margin: 0; }
  .margin-host {
    display: contents;
  }
  .margin-host:not(:empty) + .margin-empty {
    display: none;
  }
  .margin-empty {
    position: sticky;
    top: var(--hdr);
    padding: 28px 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-height: calc(100vh - var(--hdr) - var(--status));
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
  .review-ph {
    padding: 24px;
    color: var(--muted);
  }
  .review-ph .t {
    font-family: var(--font-serif);
    font-size: var(--fs-title-s);
    color: var(--ink);
    font-weight: var(--fw-strong);
    margin: 0 0 8px;
  }
</style>
