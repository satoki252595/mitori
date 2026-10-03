import type { CheckError, ErrorCode, Result } from "@mitori/core";

/** At most this many CheckErrors travel in one result (spec §5). */
export const CHECK_ERRORS_MAX = 20;

/** Error half of a `parseContract` result. */
export type ParseFailure = { code: ErrorCode; errors: CheckError[] };

/** Collects CheckErrors (≤ 20, JSON-pointer `at`) while a payload is validated. */
export class Checks {
  readonly list: CheckError[] = [];
  /** Violations seen, including those beyond the 20 that are kept. */
  count = 0;

  /** Record one violation; `actual` is rendered short (never the whole payload). */
  add(at: string, expected: string, actual: unknown, code: ErrorCode = "E_AGENT_PROTOCOL"): void {
    this.count++;
    if (this.list.length < CHECK_ERRORS_MAX) this.list.push({ at, expected, actual: describe(actual), code });
  }

  get ok(): boolean {
    return this.count === 0;
  }

  /**
   * Overall code: a write outside the scope wins (it is an injection signal, never repaired), then the first
   * error's own code.
   */
  failure(): ParseFailure {
    const scope = this.list.find((e) => e.code === "E_SCOPE_VIOLATION");
    return { code: scope ? scope.code : (this.list[0]?.code ?? "E_AGENT_PROTOCOL"), errors: this.list };
  }
}

/** Short, content-safe description of a value for `CheckError.actual`. */
export function describe(v: unknown): string {
  if (v === undefined) return "missing";
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 60 ? `string(${v.length}) "${v.slice(0, 40)}…"` : `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `array(${v.length})`;
  return "object";
}

export type Json = Record<string, unknown>;

/** Plain-object guard. */
export function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The engine payload as a value: `structured` when present, else the JSON in `text` (bare, fenced, or the outermost
 * `{…}` of a chatty reply). Anything else is an `E_AGENT_PROTOCOL` with one CheckError.
 */
export function payload(raw: { structured?: unknown; text?: string }): Result<unknown, ParseFailure> {
  if (raw.structured !== undefined && raw.structured !== null) {
    if (typeof raw.structured !== "string") return { ok: true, value: raw.structured };
    return fromText(raw.structured);
  }
  return fromText(raw.text ?? "");
}

function fromText(text: string): Result<unknown, ParseFailure> {
  const t = text.trim();
  const candidates: string[] = [t];
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/u.exec(t);
  if (fenced) candidates.push((fenced[1] as string).trim());
  const open = t.indexOf("{");
  const close = t.lastIndexOf("}");
  if (open >= 0 && close > open) candidates.push(t.slice(open, close + 1));
  for (const c of candidates) {
    if (c === "") continue;
    try {
      return { ok: true, value: JSON.parse(c) };
    } catch {
      // try the next candidate
    }
  }
  return {
    ok: false,
    error: {
      code: "E_AGENT_PROTOCOL",
      errors: [{ at: "", expected: "a JSON object", actual: t === "" ? "empty output" : `text(${t.length})`, code: "E_AGENT_PROTOCOL" }],
    },
  };
}
