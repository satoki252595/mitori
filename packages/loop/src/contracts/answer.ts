import { type AnswerOutput, type FindingsOutput, type LineNo, parseRepoPath, type RepoPath, type Result } from "@mitori/core";
import { ANSWER_CITE_RE, CONTRACT_LIMITS } from "../contract.ts";
import { Checks, isObject, type Json, type ParseFailure, payload } from "./check.ts";

type CiteExists = (path: RepoPath, start: LineNo, end: LineNo) => boolean;
type Cite = { path: RepoPath; start: LineNo; end: LineNo };

const SEVERITIES = ["info", "minor", "major", "critical"] as const;
const SUGGESTS = ["question", "change", "note"] as const;

/**
 * Parse + validate `answer/1` (spec §5.3): the claude-cli Markdown text with inline `[[path:a-b]]` cites, or the
 * JSON form `{markdown, cites}` of the other engines (inline cites and `cites` are united). A cite that does not
 * exist stays in the text and is flagged `exists: false` — never silently dropped.
 */
export function parseAnswer(
  raw: { structured?: unknown; text?: string },
  ctx: { citeExists: CiteExists },
): Result<AnswerOutput & { cites: (Cite & { exists: boolean })[] }, ParseFailure> {
  const checks = new Checks();
  const json = jsonAnswer(raw);
  let markdown: string;
  const listed: Cite[] = [];
  if (json) {
    if (typeof json.markdown !== "string") {
      checks.add("/markdown", "a string", json.markdown);
      return { ok: false, error: checks.failure() };
    }
    markdown = json.markdown;
    listed.push(...citeList(json.cites, "/cites", CONTRACT_LIMITS.answerCitesMax, checks));
  } else {
    markdown = raw.text ?? (typeof raw.structured === "string" ? raw.structured : "");
  }
  if (markdown.trim() === "") checks.add("/markdown", "a non-empty answer", markdown);
  if (markdown.length > CONTRACT_LIMITS.answerMaxChars) checks.add("/markdown", `at most ${CONTRACT_LIMITS.answerMaxChars} characters`, markdown);

  const cites = unite(inlineCites(markdown), listed);
  if (cites.length > CONTRACT_LIMITS.answerCitesMax) checks.add("/cites", `at most ${CONTRACT_LIMITS.answerCitesMax} citations`, cites);
  if (!checks.ok) return { ok: false, error: checks.failure() };
  return { ok: true, value: { markdown, cites: cites.map((c) => ({ ...c, exists: exists(c, ctx.citeExists) })) } };
}

/** Parse + validate `findings/1` (spec §5.4): ≤ 10 findings, stable-sorted by severity; cites that do not exist are dropped. */
export function parseFindings(raw: { structured?: unknown; text?: string }, ctx: { citeExists: CiteExists }): Result<FindingsOutput, ParseFailure> {
  const body = payload(raw);
  if (!body.ok) return body;
  const checks = new Checks();
  const o = body.value;
  if (!isObject(o) || !Array.isArray(o.findings)) {
    checks.add("/findings", "an array", isObject(o) ? o.findings : o);
    return { ok: false, error: checks.failure() };
  }
  if (o.findings.length > CONTRACT_LIMITS.findingsMax) checks.add("/findings", `at most ${CONTRACT_LIMITS.findingsMax} findings`, o.findings);
  const out: FindingsOutput["findings"] = [];
  for (const [i, item] of o.findings.slice(0, CONTRACT_LIMITS.findingsMax).entries()) {
    const at = `/findings/${i}`;
    if (!isObject(item)) {
      checks.add(at, "a finding object", item);
      continue;
    }
    const before = checks.count;
    if (typeof item.title !== "string" || item.title.trim() === "" || item.title.length > CONTRACT_LIMITS.findingTitleMaxChars) {
      checks.add(`${at}/title`, `1–${CONTRACT_LIMITS.findingTitleMaxChars} characters`, item.title);
    }
    if (typeof item.body !== "string" || item.body.length > CONTRACT_LIMITS.findingBodyMaxChars) {
      checks.add(`${at}/body`, `a string of at most ${CONTRACT_LIMITS.findingBodyMaxChars} characters`, item.body);
    }
    if (!(SEVERITIES as readonly unknown[]).includes(item.severity)) checks.add(`${at}/severity`, SEVERITIES.join(" | "), item.severity);
    if (!(SUGGESTS as readonly unknown[]).includes(item.suggest)) checks.add(`${at}/suggest`, SUGGESTS.join(" | "), item.suggest);
    const cites = citeList(item.cites, `${at}/cites`, CONTRACT_LIMITS.findingCitesMax, checks);
    if (checks.count > before) continue;
    out.push({
      title: item.title as string,
      body: item.body as string,
      severity: item.severity as (typeof SEVERITIES)[number],
      cites: cites.filter((c) => exists(c, ctx.citeExists)),
      suggest: item.suggest as (typeof SUGGESTS)[number],
    });
  }
  if (!checks.ok) return { ok: false, error: checks.failure() };
  const rank = (s: string) => SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);
  const sorted = out.map((f, i) => ({ f, i })).sort((a, b) => rank(b.f.severity) - rank(a.f.severity) || a.i - b.i);
  return { ok: true, value: { findings: sorted.map((s) => s.f) } };
}

/** The `{markdown, cites}` object when the engine answered in JSON (structured, or JSON text with a `markdown` key). */
function jsonAnswer(raw: { structured?: unknown; text?: string }): Json | null {
  if (isObject(raw.structured)) return raw.structured;
  const t = (raw.text ?? "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const v: unknown = JSON.parse(t);
    return isObject(v) && typeof v.markdown === "string" ? v : null;
  } catch {
    return null;
  }
}

/** `[[path:a-b]]` / `[[path:line]]` tokens in order of appearance (split at the last colon). */
function inlineCites(markdown: string): Cite[] {
  const out: Cite[] = [];
  for (const m of markdown.matchAll(new RegExp(ANSWER_CITE_RE.source, "gu"))) {
    const start = Number(m[2]);
    out.push({ path: m[1] as string, start, end: m[3] === undefined ? start : Number(m[3]) });
  }
  return out;
}

function citeList(v: unknown, at: string, max: number, checks: Checks): Cite[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    checks.add(at, "an array of {path, start, end}", v);
    return [];
  }
  if (v.length > max) checks.add(at, `at most ${max} citations`, v);
  const out: Cite[] = [];
  for (const [i, c] of v.slice(0, max).entries()) {
    if (!isObject(c) || typeof c.path !== "string" || !Number.isInteger(c.start) || !Number.isInteger(c.end)) {
      checks.add(`${at}/${i}`, "{path: string, start: integer, end: integer}", c);
      continue;
    }
    out.push({ path: c.path, start: c.start as number, end: c.end as number });
  }
  return out;
}

function unite(a: readonly Cite[], b: readonly Cite[]): Cite[] {
  const seen = new Set<string>();
  const out: Cite[] = [];
  for (const c of [...a, ...b]) {
    const key = `${c.path}\u0000${c.start}\u0000${c.end}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/** A cite exists only if its path is a valid RepoPath and the host confirms the range; an invalid path never reaches the host. */
function exists(c: Cite, citeExists: CiteExists): boolean {
  if (c.start < 1 || c.end < c.start) return false;
  const p = parseRepoPath(c.path);
  return p.ok && citeExists(p.value, c.start, c.end);
}
