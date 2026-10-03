// Calibrated estimation (indexer spec §7.6, R1 CONS-24): only the `kind:*` chars/token factors are applied here —
// per-call (intent × model) corrections belong to the caller's estimator. Also the text-kind choice of §2.6.
import { type CalibrationSnapshot, CHARS_PER_TOKEN, type FileClass, type TextKind, type TokenizerId } from "@mitori/core";
import type { CalibrationSample } from "../contract.ts";
import { extOf } from "../lang/detect.ts";
import { countCjk } from "./index.ts";

/** Calibrated estimate from character counts (`chars` = UTF-16 code units, `cjk` ⊆ chars). */
export function estimateFromCounts(chars: number, cjk: number, kind: TextKind, tokenizer: TokenizerId, calib?: CalibrationSnapshot): number {
  const cpt = CHARS_PER_TOKEN[tokenizer];
  const fk = calib?.kindFactor(tokenizer, kind) ?? 1;
  const fja = calib?.kindFactor(tokenizer, "markdown_ja") ?? 1;
  return Math.ceil(Math.max(0, chars - cjk) / (cpt[kind] / fk) + cjk / (cpt.markdown_ja / fja));
}

/** Calibrated estimate of a text. */
export function estimateText(text: string, kind: TextKind, tokenizer: TokenizerId, calib?: CalibrationSnapshot): number {
  return estimateFromCounts(text.length, countCjk(text), kind, tokenizer, calib);
}

/**
 * Text kind of a whole file (spec §2.6): minified → minified, lockfile → lock, docs → markdown_en/ja by CJK share,
 * `*.json` → json, `*.css` → css, everything else code.
 */
export function kindOfFile(path: string, cls: FileClass, chars: number, cjk: number): TextKind {
  if (cls === "minified") return "minified";
  if (cls === "lockfile") return "lock";
  if (cls === "docs") return chars > 0 && cjk / chars > 0.1 ? "markdown_ja" : "markdown_en";
  const ext = extOf(path);
  if (ext === "json" || ext === "jsonc" || ext === "json5") return "json";
  if (ext === "css" || ext === "scss" || ext === "sass" || ext === "less") return "css";
  return "code";
}

/** Raw (uncalibrated) estimate used as the ratio's denominator when validating a calibration sample. */
function rawFromSample(s: CalibrationSample): number {
  const cpt = CHARS_PER_TOKEN[s.tokenizer];
  return Math.max(0, s.chars - s.cjk) / cpt[s.kind] + s.cjk / cpt.markdown_ja;
}

/** `calibrate()` validation (spec §7.6): chars ≥ 2,000 and 0.25 < tokens / raw < 4. */
export function validCalibrationSample(s: CalibrationSample): boolean {
  if (!(s.chars >= 2_000) || s.cjk < 0 || s.cjk > s.chars || !(s.tokens > 0)) return false;
  const r = s.tokens / rawFromSample(s);
  return r > 0.25 && r < 4;
}
