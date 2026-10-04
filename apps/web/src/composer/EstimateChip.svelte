<!--
  Estimate chip (contract `EstimateChipProps`, ux.md §6.8, JUDGEMENT §6.5-7): 「≈{in} in · ≈{out} out · ${usd} ·
  約{p25}–{p75}秒」 behind the band dot; the breakdown popover opens on hover / focus (never steals focus, WCAG
  1.4.13: hoverable, dismissable with Escape). `line` = the newcomer's one cost line (「約5秒 · サブスクの枠内」).
-->
<script lang="ts">
import { type BillingMode, type ClaudeModelId, type EstimateItem, PRICING, type TokenBand } from "@mitori/core";
import { fmtTokens, fmtUsd, t } from "../shell/index.ts";

let {
  tokensIn,
  tokensOut,
  usd,
  seconds,
  band,
  items,
  accuracy,
  model,
  billing = "unknown",
  instr = 0,
  flash = false,
  pending = false,
  form = "chip",
}: {
  tokensIn: number;
  tokensOut: number;
  usd: number | null;
  seconds: { lo: number; hi: number; n: number };
  band: TokenBand;
  items: readonly EstimateItem[];
  accuracy: { pct: number; n: number };
  model: string;
  billing?: BillingMode;
  instr?: number;
  flash?: boolean;
  /** No server estimate yet: the numbers are the client prediction (`≈`). */
  pending?: boolean;
  form?: "chip" | "line";
} = $props();

let open = $state(false);
let timer: ReturnType<typeof setTimeout> | null = null;
const price = $derived((PRICING as Partial<Record<string, (typeof PRICING)[ClaudeModelId]>>)[model] ?? null);
const secs = $derived(seconds.lo === seconds.hi ? t("composer.est.secs", { n: seconds.lo }) : t("composer.est.secsRange", { lo: seconds.lo, hi: seconds.hi }));
const cost = $derived(usd === null ? "—" : fmtUsd(usd, "job"));
const billed = $derived(
  billing === "subscription-window"
    ? t("composer.est.inWindow")
    : billing === "metered-api" || billing === "overage"
      ? t("composer.est.billed", { usd: cost })
      : "",
);
const fixed = $derived(items.filter((i) => i.cached).reduce((n, i) => n + i.tokens, 0));
const id = `est-${Math.random().toString(36).slice(2, 8)}`;

function show(on: boolean) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (open = on), on ? 300 : 160);
}
</script>

{#if form === "line"}
  <p class="est-line" class:flash data-chrome>{secs}{#if billed}<span class="sep" aria-hidden="true">·</span>{billed}{/if}</p>
{:else}
  <span class="est-wrap">
    <button
      type="button"
      class="est mono"
      class:flash
      class:pending
      aria-describedby={open ? id : undefined}
      onpointerenter={() => show(true)}
      onpointerleave={() => show(false)}
      onfocus={() => (open = true)}
      onblur={() => (open = false)}
      data-chrome
    >
      <span class="band" data-band={band} aria-hidden="true"></span>
      <span>{fmtTokens(tokensIn, { approx: true })} in</span><span class="sep" aria-hidden="true">·</span><span>{fmtTokens(tokensOut, { approx: true })} out</span><span class="sep" aria-hidden="true">·</span><span>{cost}</span><span class="sep" aria-hidden="true">·</span><span>{secs}</span>
    </button>
    {#if open}
      <div class="est-pop" role="tooltip" {id} onpointerenter={() => show(true)} onpointerleave={() => show(false)} data-chrome>
        <p class="h">{t("composer.est.breakdown")}</p>
        <ul>
          {#each items.filter((i) => i.kind !== "output") as it (it.key)}
            <li><span class="l" data-user-content>{it.label}</span><span class="v mono">{fmtTokens(it.tokens)}{#if it.cached}<span class="c"> {t("composer.est.cache")}</span>{/if}</span></li>
          {/each}
          {#if instr > 0}<li><span class="l">{t("composer.est.instr")}</span><span class="v mono">{fmtTokens(instr)}</span></li>{/if}
          <li><span class="l">{t("composer.est.out")}</span><span class="v mono">{fmtTokens(tokensOut)}</span></li>
        </ul>
        <p class="tot mono">{t("composer.est.total", { tok: fmtTokens(tokensIn + tokensOut), usd: cost, cache: fmtTokens(fixed) })}</p>
        {#if price}<p class="note">{t("composer.est.price", { model, in: price.inPerMTok, cr: price.cacheReadPerMTok, out: price.outPerMTok })}</p>{/if}
        <p class="note">{t("composer.est.accuracy", { p: accuracy.pct, n: accuracy.n })}{#if pending} · {t("composer.est.predicted")}{/if}</p>
      </div>
    {/if}
  </span>
{/if}

<style>
  .est-wrap {
    position: relative;
    display: inline-flex;
  }
  .est {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--r-chip-l);
    background: var(--paper-2);
    border: 1px solid transparent;
    color: var(--text);
    font-size: var(--fs-meta);
    white-space: nowrap;
    transition: border-color 0.35s;
  }
  .est.flash {
    border-color: var(--accent);
  }
  .est.pending {
    color: var(--muted);
  }
  .sep {
    color: var(--muted);
  }
  .band {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--band-10k);
    flex: none;
  }
  .band[data-band="lt10k"] {
    background: var(--band-lt10k);
  }
  .band[data-band="50k_200k"] {
    background: var(--band-50k);
  }
  .band[data-band="gt200k"] {
    background: var(--band-200k);
  }
  .est-line {
    margin: 0;
    font-size: var(--fs-ui-s);
    color: var(--muted);
  }
  .est-line .sep {
    margin: 0 5px;
  }
  .est-pop {
    position: absolute;
    left: 0;
    bottom: calc(100% + 6px);
    z-index: var(--z-popover);
    width: var(--est-pop-w);
    padding: 10px 12px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--sheet);
    box-shadow: var(--shadow-pop);
    font-size: var(--fs-label);
    color: var(--text);
  }
  .est-pop .h {
    margin: 0 0 6px;
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .est-pop ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .est-pop li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 1px 0;
  }
  .est-pop .l {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .est-pop .c {
    color: var(--muted);
  }
  .est-pop .tot {
    margin: 6px 0 0;
    padding-top: 6px;
    border-top: 1px solid var(--rule-soft);
    color: var(--ink);
  }
  .est-pop .note {
    margin: 4px 0 0;
    color: var(--muted);
  }
</style>
