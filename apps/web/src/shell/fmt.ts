/**
 * Number formatting (ux.md §9.3, JUDGEMENT §6.17, contract `NUMBER_FORMAT`). The rules (thresholds, decimals,
 * U+2212) live here; the words around the numbers (`約` / `~`, `秒` / `s`, `分` / `min`) come from the active
 * catalog's `fmt.*` keys (§9.1), so no UI text is written in code (lint `mitori/no-ja-literal`).
 */
import type { UiLang } from "@mitori/core";
import { NUMBER_FORMAT, type UsdContext } from "../contract.ts";
import { tIn } from "./i18n.ts";

const MINUS = NUMBER_FORMAT.deltaMinus;

/**
 * M-notation starts at 0.1 M: every example in the spec (`≈0.12M`, `0.38M`, `0.4M`) is below the contract's
 * `mThreshold` (1 M), so the contract value is read as "M scale" and applied from a tenth of it.
 * CR-PENDING(WP-10a): docs/design/cr-requests/WP-10a.md asks to restate `mThreshold`.
 */
const M_FROM = NUMBER_FORMAT.tokens.mThreshold / 10;

/** Fixed decimals with trailing zeros (and a dangling dot) removed: 0.40 → 0.4, 52.0 → 52. */
function trimFixed(v: number, decimals: number): string {
  return v
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

export function fmtTokensImpl(n: number, opts: { approx?: boolean; main?: boolean; lang?: UiLang } = {}): string {
  const { kThreshold, kDecimals, mDecimals } = NUMBER_FORMAT.tokens;
  const a = Math.abs(n);
  const body = a >= M_FROM ? `${trimFixed(n / 1_000_000, mDecimals)}M` : a >= kThreshold ? `${trimFixed(n / 1000, kDecimals)}k` : String(Math.round(n));
  if (opts.main) return tIn(opts.lang, "fmt.about", { v: body });
  return opts.approx ? `≈${body}` : body;
}

export function fmtUsdImpl(n: number, ctx: UsdContext): string {
  const d = NUMBER_FORMAT.usd[ctx];
  if (n > 0 && n < 10 ** -d) return `<$${(10 ** -d).toFixed(d)}`;
  return `$${n.toFixed(d)}`;
}

/** `m:ss` (live counters). */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * < 60 s: one decimal (`fmt.secs`). `job` ≥ 60 s: minutes + seconds (`fmt.minSec`). `gen` ≥ 60 s (estimates):
 * whole minutes (`fmt.aboutMin`). Words come from the `lang` catalog when it is loaded, else the active one.
 */
export function fmtDurationImpl(ms: number, ctx: "job" | "gen", lang?: UiLang): string {
  const sec = ms / 1000;
  if (sec < NUMBER_FORMAT.seconds.minuteThreshold) return tIn(lang, "fmt.secs", { n: sec.toFixed(NUMBER_FORMAT.seconds.decimals) });
  if (ctx === "gen") return tIn(lang, "fmt.aboutMin", { n: Math.max(1, Math.round(sec / 60)) });
  const whole = Math.round(sec);
  return tIn(lang, "fmt.minSec", { m: Math.floor(whole / 60), s: whole % 60 });
}

/** Signed integer percent of `actual` vs `estimate` (U+2212 for minus): `−2%`, `+5%`, `±0%`. */
export function fmtDeltaImpl(actual: number, estimate: number): string {
  if (!(estimate > 0)) return "±0%";
  const p = Math.round(((actual - estimate) / estimate) * 100);
  if (p === 0) return "±0%";
  return p < 0 ? `${MINUS}${-p}%` : `+${p}%`;
}

/** LOC in prose: `45.7k LOC` → returns `45.7k` (the unit comes from the catalog). */
export function fmtLocShort(n: number): string {
  return n >= 1000 ? `${trimFixed(n / 1000, 1)}k` : String(n);
}

/** A long path shortened in the middle (`~/work/…/repo`), keeping the start and the most specific end. */
export function ellipsizeMiddle(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - (keep - head)).join("")}`;
}

/** Integers in tables: `45,672`. */
export function fmtInt(n: number, lang: UiLang): string {
  return new Intl.NumberFormat(lang === "ja" ? "ja-JP" : "en-US").format(Math.round(n));
}

/** Percent of a 0–1 ratio, no decimals. */
export function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const SPACES = /[   ]/g;

/** Relative time; ja drops the spaces between digits and kana (`3 日前` → `3日前`, ux.md §9.3). */
export function fmtRelative(iso: string, nowMs: number, lang: UiLang): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = (t - nowMs) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(diff);
  const [v, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60
      ? [diff, "second"]
      : abs < 3600
        ? [diff / 60, "minute"]
        : abs < 86400
          ? [diff / 3600, "hour"]
          : abs < 86400 * 30
            ? [diff / 86400, "day"]
            : abs < 86400 * 365
              ? [diff / (86400 * 30), "month"]
              : [diff / (86400 * 365), "year"];
  const s = rtf.format(Math.round(v), unit);
  return lang === "ja" ? s.replace(SPACES, "") : s;
}

/** Date + time, `Intl.DateTimeFormat(lang, {dateStyle: "medium", timeStyle: "short"})`. */
export function fmtDateTime(iso: string, lang: UiLang): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(t);
}

/** `HH:MM` local time. */
export function fmtHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
