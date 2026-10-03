import { REDACTION_TOKEN, SECRET_RULES, type SecretHit, type SecretRule, type SecretScanner } from "./domain.ts";
import { MitoriError } from "./errors.ts";

/**
 * Literal substrings one of which must occur for a built-in rule to match at all (cheap prefilter so a 1 MB
 * text costs a few `indexOf`s, not 16 regex passes). `ci` hints are tested against the lower-cased text.
 */
const HINTS: Readonly<Record<(typeof SECRET_RULES)[number]["id"], { any: readonly string[]; ci?: true }>> = {
  aws_access_key: { any: ["AKIA", "ASIA"] },
  aws_secret: { any: ["aws"], ci: true },
  github_token: { any: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"] },
  github_pat: { any: ["github_pat_"] },
  gitlab_token: { any: ["glpat-"] },
  slack_token: { any: ["xoxa-", "xoxb-", "xoxp-", "xoxr-", "xoxs-"] },
  slack_webhook: { any: ["hooks.slack.com"] },
  anthropic_key: { any: ["sk-ant-"] },
  openai_key: { any: ["sk-"] },
  google_api_key: { any: ["AIza"] },
  stripe_key: { any: ["_live_", "_test_"] },
  npm_token: { any: ["npm_"] },
  private_key: { any: ["PRIVATE KEY-----"] },
  jwt: { any: ["eyJ"] },
  url_credentials: { any: ["://"] },
  generic_assignment: { any: ["pass", "secret", "token", "key"], ci: true },
};

/** Values that are obviously not secrets (loop spec §12.2): never reported. */
const PLACEHOLDER_RES: readonly RegExp[] = [/x{4,}/i, /changeme/i, /<[^>]*>/, /\$\{/, /process\.env\./, /os\.environ/, /example/i, /dummy/i];

interface Compiled {
  id: string;
  re: RegExp;
  entropy: number | undefined;
  hint: { any: readonly string[]; ci?: true } | undefined;
}

function compile(rule: SecretRule): Compiled {
  let flags = rule.flags;
  for (const f of ["g", "d"]) if (!flags.includes(f)) flags += f;
  let re: RegExp;
  try {
    re = new RegExp(rule.source, flags);
  } catch (e) {
    throw new MitoriError("E_INVALID_INPUT", `secret rule ${rule.id}: invalid RegExp`, { cause: e });
  }
  return { id: rule.id, re, entropy: rule.entropy, hint: (HINTS as Record<string, Compiled["hint"]>)[rule.id] };
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = [...s].length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/** True for placeholder-looking values (`xxxx`, `changeme`, `<…>`, `${…}`, env lookups, `example`, `dummy`, one repeated char). */
export function isPlaceholderSecret(value: string): boolean {
  if (PLACEHOLDER_RES.some((r) => r.test(value))) return true;
  const alnum = value.replace(/[^A-Za-z0-9]/g, "");
  return alnum.length > 0 && /^(.)\1*$/.test(alnum.slice(-12));
}

interface Span {
  rule: string;
  order: number;
  start: number;
  end: number;
}

/**
 * Create the scanner (pure; one pass per rule whose literal hint occurs; placeholder filter and entropy check
 * applied). A rule with a capture group reports/redacts only group 1 (the value, not the key name).
 * Overlapping hits keep the earliest, then longest, then first-listed rule.
 */
export function createSecretScanner(extraRules: readonly SecretRule[] = []): SecretScanner {
  const rules = [...SECRET_RULES, ...extraRules].map(compile);

  const spans = (text: string): Span[] => {
    let lower: string | undefined;
    const found: Span[] = [];
    rules.forEach((r, order) => {
      if (r.hint) {
        if (r.hint.ci && lower === undefined) lower = text.toLowerCase();
        const hay = r.hint.ci ? (lower as string) : text;
        if (!r.hint.any.some((h) => hay.includes(h))) return;
      }
      r.re.lastIndex = 0;
      for (let m = r.re.exec(text); m !== null; m = r.re.exec(text)) {
        if (m[0].length === 0) {
          r.re.lastIndex++;
          continue;
        }
        const group = m.indices?.[1];
        const [start, end] = group ?? [m.index, m.index + m[0].length];
        const value = text.slice(start, end);
        if (isPlaceholderSecret(value)) continue;
        if (r.entropy !== undefined && shannonEntropy(value) < r.entropy) continue;
        found.push({ rule: r.id, order, start, end });
      }
    });
    found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.order - b.order);
    const kept: Span[] = [];
    let lastEnd = -1;
    for (const s of found) {
      if (s.start < lastEnd) continue;
      kept.push(s);
      lastEnd = s.end;
    }
    return kept;
  };

  return {
    scan(text) {
      const found = spans(text);
      if (found.length === 0) return [];
      const lineStarts = [0];
      for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lineStarts.push(i + 1);
      return found.map((s): SecretHit => ({ rule: s.rule, line: lineOf(lineStarts, s.start), start: s.start, end: s.end }));
    },
    redact(text) {
      const found = spans(text);
      if (found.length === 0) return { text, redactions: 0, rules: [] };
      let out = "";
      let at = 0;
      for (const s of found) {
        const newlines = text.slice(s.start, s.end).split("\n").length - 1;
        out += text.slice(at, s.start) + REDACTION_TOKEN + "\n".repeat(newlines);
        at = s.end;
      }
      out += text.slice(at);
      return { text: out, redactions: found.length, rules: [...new Set(found.map((s) => s.rule))].sort() };
    },
  };
}

function lineOf(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
