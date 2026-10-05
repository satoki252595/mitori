<!--
  Block history (EX-10, ux.md §4.3.12): the paragraph's revisions newest first — what changed it (生成 · 人の編集 ·
  修正を採用 · 取り消し …), who, when, which review round — from `GET /doc/blocks/:block/history`, and the
  paragraph-wide human check: 「✓✓ 確かめた」 marks every claim of the paragraph human-verified (kept across
  regenerations), 「確認を外す」 takes it back. Opened from the gutter (詳しい) or ⌘K. One reader popover at a time.
-->
<script lang="ts">
import type { BlockHistoryEntry } from "@mitori/core";
import { onMount } from "svelte";
import { fmtDateTime } from "../shell/fmt.ts";
import { t } from "../shell/index.ts";
import { followAnchor, naturalHeight, popoverPos } from "./popover.ts";

let {
  entries,
  error,
  anchorEl,
  lang,
  verified,
  verifiedBy,
  claims,
  busy,
  onverify,
  onrevert,
  onclose,
}: {
  entries: readonly BlockHistoryEntry[] | null;
  error: string | null;
  anchorEl: HTMLElement;
  lang: "ja" | "en";
  verified: boolean;
  verifiedBy: string | null;
  claims: number;
  busy: boolean;
  onverify: (next: boolean) => void;
  onrevert: (rev: number) => void;
  onclose: () => void;
} = $props();

let el: HTMLDivElement | undefined = $state();
let pos = $state<{ left: number; top: number; maxH: number | null }>({ left: 0, top: 0, maxH: null });
onMount(() =>
  followAnchor(() => {
    pos = popoverPos(anchorEl.getBoundingClientRect(), 380, naturalHeight(el, 200), window.innerWidth, window.innerHeight);
  }, el),
);

const rows = $derived([...(entries ?? [])].reverse());
const who = (by: string) => (by === "human" ? t("history.by.human") : by === "system" ? t("history.by.system") : by.startsWith("agent:") ? by.slice(6) : by);
</script>

<div
  class="pop hist"
  bind:this={el}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:max-height={pos.maxH === null ? undefined : `${pos.maxH}px`}
  role="dialog"
  aria-labelledby="hist-t"
  data-chrome
>
  <p class="h" id="hist-t">{t("history.title")}</p>
  <button type="button" class="x" aria-label={t("help.close")} onclick={onclose}>&times;</button>
  {#if error}
    <p class="err" role="alert">{error}</p>
  {:else if entries === null}
    <div class="skel row" aria-busy="true"></div>
    <div class="skel row" aria-hidden="true"></div>
  {:else if rows.length === 0}
    <p class="none">{t("history.none")}</p>
  {:else}
    <ol class="list">
      {#each rows as e, i (e.rev)}
        <li class:cur={i === 0}>
          <span class="rev mono">R{e.rev}</span>
          <span class="src">{t(`history.source.${e.source}`)}{#if e.round !== undefined}<span class="rnd"> · {t("history.round", { n: e.round })}</span>{/if}</span>
          <span class="meta">{who(e.by)} · {fmtDateTime(e.at, lang)}{#if i === 0} · <b>{t("history.current")}</b>{/if}</span>
          {#if i > 0}<button type="button" class="btn btn-gh btn-s revert" disabled={busy} onclick={() => onrevert(e.rev)}>{t("history.revert")}</button>{/if}
        </li>
      {/each}
    </ol>
  {/if}
  {#if claims > 0}
    <div class="ver">
      {#if verified}
        <p class="vs"><span class="vv" aria-hidden="true">&#x2713;&#x2713;</span> {verifiedBy ? t("history.verifiedBy", { name: verifiedBy }) : t("history.verified")}</p>
        <button type="button" class="btn btn-gh btn-s" disabled={busy} onclick={() => onverify(false)}>{t("history.unverify")}</button>
      {:else}
        <p class="vs">{t("history.verifyHint", { n: claims })}</p>
        <button type="button" class="btn btn-sec btn-s" disabled={busy} onclick={() => onverify(true)}>&#x2713;&#x2713; {t("history.verify")}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .hist {
    width: 380px;
    padding: 12px 14px;
    overflow-y: auto;
  }
  .h {
    margin: 0 28px 8px 0;
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 0 8px;
    padding: 6px 0;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--fs-ui-s);
  }
  .list li:first-child {
    border-top: 0;
  }
  .rev {
    grid-row: span 2;
    font-size: var(--fs-meta);
    color: var(--muted);
    padding-top: 2px;
  }
  .revert { grid-column: 2; justify-self: start; margin-top: 4px; }
  .src {
    color: var(--text);
  }
  .cur .src {
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .rnd,
  .meta {
    color: var(--muted);
    font-weight: var(--fw-regular);
  }
  .meta {
    font-size: var(--fs-meta);
  }
  .meta b {
    font-weight: var(--fw-strong);
    color: var(--text);
  }
  .ver {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--rule);
  }
  .vs {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .vv {
    color: var(--v-human);
    font-weight: var(--fw-strong);
  }
  .none,
  .err {
    margin: 4px 0;
    font-size: var(--fs-ui-s);
    color: var(--muted);
  }
  .err {
    color: var(--c-bad);
  }
  .skel.row {
    height: 36px;
    margin: 4px 0;
  }
  .x {
    position: absolute;
    right: 8px;
    top: 8px;
    width: 26px;
    height: 26px;
    border-radius: var(--r-btn);
    color: var(--muted);
  }
  .x:hover {
    background: var(--hover);
    color: var(--ink);
  }
</style>
