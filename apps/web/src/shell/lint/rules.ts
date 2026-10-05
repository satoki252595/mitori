/**
 * Web lint (ux.md §13.2 — the 12 `mitori/*` rules — plus a few WP-10a extras from §3.1 / §12.2 / §12.7). Biome
 * has no plugin API for these, so they are text rules over the sources, run by `bun test` (rules.test.ts) with a
 * self-test per rule (WEB-U-012) until `scripts/lint-web.ts` exists. Each rule: (path, source) → findings.
 * Comments are blanked first (line numbers kept) so documentation may mention what code must not do.
 */

export interface Finding {
  rule: string;
  file: string;
  line: number;
  text: string;
}

export interface Rule {
  id: string;
  /** Spec reference. */
  why: string;
  applies(file: string): boolean;
  check(file: string, code: string): Omit<Finding, "rule" | "file">[];
}

const isTest = (f: string) => /\.test\.ts$/.test(f) || /[\\/](__tests__|lint)[\\/]/.test(f);
const isCode = (f: string) => /\.(ts|svelte)$/.test(f) && !isTest(f);
const isStyle = (f: string) => /\.(css|svelte)$/.test(f);
const JA_CLASS = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";

/** Blank out comments (JS line/block, HTML), keeping line numbers. Strings are left alone. */
export function stripComments(src: string): string {
  const keepLines = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/<!--[\s\S]*?-->/g, keepLines)
    .replace(/\/\*[\s\S]*?\*\//g, keepLines)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre: string) => pre + keepLines(m.slice(pre.length)));
}

function lineOf(code: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (code.charCodeAt(i) === 10) n++;
  return n;
}

function scan(code: string, re: RegExp): { line: number; text: string; index: number }[] {
  const out: { line: number; text: string; index: number }[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (let m = g.exec(code); m; m = g.exec(code)) {
    out.push({ line: lineOf(code, m.index), text: m[0].slice(0, 80), index: m.index });
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

const hits = (code: string, re: RegExp) => scan(code, re).map(({ line, text }) => ({ line, text }));

/** Reviewed sinks, not whole-file exemptions: chrome builders escape values; Reader fill validates sanitized DTO hashes. */
const HTML_SINKS: Readonly<Record<string, RegExp>> = {
  "src/shell/Header.svelte": /\{@html initialHtml\[[0-4]\] \?\? ""\}/g,
  "src/shell/Rail.svelte": /\{@html initialHtml\}/g,
  "src/shell/StatusBar.svelte": /\{@html initialHtml\}/g,
  "src/shell/native.ts": /(?:template\.innerHTML = html;|old\.innerHTML = next\.innerHTML;)/g,
  "src/map/FloorPlan.svelte": /\{@html initialSvg\}/g,
  "src/reader/native.ts": /(?:prose|el)\.innerHTML = old\.html;/g,
};

function untrustedHtml(file: string, code: string): { line: number; text: string }[] {
  const approved = HTML_SINKS[file.replaceAll("\\", "/")];
  const ranges = approved ? [...code.matchAll(approved)].map((m) => [m.index, m.index + m[0].length] as const) : [];
  return [scan(code, /\{@html\b/), scan(code, /\.(inner|outer)HTML\s*=/), scan(code, /insertAdjacentHTML/)]
    .flat()
    .filter((m) => !ranges.some(([a, b]) => m.index >= a && m.index + m.text.length <= b))
    .map(({ line, text }) => ({ line, text }));
}

/** `<style>` blocks of a component (or the whole file for .css); everything else blanked. */
function styles(file: string, code: string): string {
  if (file.endsWith(".css")) return code;
  return code.replace(/<style[^>]*>([\s\S]*?)<\/style>|[\s\S]/g, (m, css?: string) => (css !== undefined ? m : m === "\n" ? "\n" : " "));
}

/** Innermost CSS rule bodies `{ … }` with their start index. */
function cssRules(css: string): { body: string; index: number }[] {
  return [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => ({ body: m[1] as string, index: m.index }));
}

/** Does the handler starting at `at` (an arrow / function) begin with the IME guard? */
function guardedAt(code: string, at: number): boolean {
  if (at < 0) return false;
  const rest = code.slice(at, at + 600);
  const arrow = /^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*\{\s*/.exec(rest);
  const fn = /^\s*(?:async\s+)?function\b[^(]*\([^)]*\)[^{]*\{\s*/.exec(rest);
  const head = arrow ?? fn;
  if (!head) return false;
  return /^if\s*\(\s*isComposing\(/.test(rest.slice(head[0].length));
}

/** A handler expression: inline arrow / function, or the name of one defined in the same file. */
function guardedHandler(code: string, exprAt: number): boolean {
  const name = /^\s*([A-Za-z_$][\w$]*)\s*[,)}]/.exec(code.slice(exprAt, exprAt + 80))?.[1];
  if (!name || name === "async" || name === "function") return guardedAt(code, exprAt);
  const def = new RegExp(`function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=\\s*`).exec(code);
  if (!def) return false;
  return def[0].startsWith("function") ? guardedAt(code, def.index) : guardedAt(code, def.index + def[0].length);
}

export const SPEC_RULES = [
  "mitori/ime-guard",
  "mitori/no-ja-literal",
  "mitori/no-ja-space",
  "mitori/no-raw-color",
  "mitori/no-raw-z",
  "mitori/no-fw-weight",
  "mitori/no-font-face",
  "mitori/faint-surface",
  "mitori/storage-wrapper",
  "mitori/no-direct-fetch",
  "mitori/no-line-components",
  "mitori/no-progressbar",
] as const;

export const RULES: Rule[] = [
  {
    id: "mitori/ime-guard",
    why: "§13.2: a keydown / keyup listener's first statement is `if (isComposing(e)) return`, or it goes through the registry",
    applies: isCode,
    check(file, code) {
      const out: { line: number; text: string }[] = [];
      if (/stores[\\/]keys\.svelte\.ts$/.test(file)) {
        for (const h of scan(code, /#onKey(Up)?\(e: KeyboardEvent\): void \{\s*/)) {
          if (!/^if \(isComposing\(e\)\)/.test(code.slice(h.index + h.text.length)))
            out.push({ line: h.line, text: "registry handler without the guard first" });
        }
        return out;
      }
      for (const m of code.matchAll(/addEventListener\(\s*["'`]key(?:down|up)["'`]\s*,/g)) {
        if (!guardedHandler(code, m.index + m[0].length)) out.push({ line: lineOf(code, m.index), text: m[0] });
      }
      for (const m of code.matchAll(/\bonkey(?:down|up)\s*=\s*\{/g)) {
        if (!guardedHandler(code, m.index + m[0].length)) out.push({ line: lineOf(code, m.index), text: m[0] });
      }
      return out;
    },
  },
  {
    id: "mitori/no-ja-literal",
    why: "§9.5-2: no Japanese in string literals, templates or markup text (catalogs only)",
    applies: isCode,
    check: (_f, code) => hits(code, new RegExp(`[${JA_CLASS}]+`, "u")),
  },
  {
    id: "mitori/no-ja-space",
    why: "§9.2 / §13.2: ja catalog values carry no half-width space between Japanese and Latin / digits",
    applies: (f) => /i18n[\\/][^\\/]+\.ja\.json$/.test(f),
    check(_f, code) {
      const out: { line: number; text: string }[] = [];
      const re = new RegExp(`[${JA_CLASS}] [A-Za-z0-9]|[A-Za-z0-9] [${JA_CLASS}]`, "u");
      code.split("\n").forEach((l, i) => {
        const m = /^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/.exec(l);
        if (!m) return;
        // placeholders become `1` / `a` before the check (§9.2)
        const v = (m[2] as string).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_p, n: string) => (/^(n|count|files|k|min|s|m|id|p|q)$/.test(n) ? "1" : "a"));
        if (re.test(v)) out.push({ line: i + 1, text: `${m[1]}: ${(m[2] as string).slice(0, 60)}` });
      });
      return out;
    },
  },
  {
    id: "mitori/no-raw-color",
    why: "§13.2: component CSS uses var(--…) colours only (tokens.css excepted)",
    applies: (f) => isStyle(f) && !/tokens\.css$/.test(f),
    check: (file, code) => hits(styles(file, code), /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/),
  },
  {
    id: "mitori/no-raw-z",
    why: "§13.2: z-index is var(--z-*) or 0–5",
    applies: isStyle,
    check: (file, code) => hits(styles(file, code), /z-index:\s*(?!var\(--z-|[0-5]\s*[;}\n])[^\s;}][^;}\n]*/),
  },
  {
    id: "mitori/no-fw-weight",
    why: "§13.2: font-weight is 400 / 600 / var(--fw-*)",
    applies: isStyle,
    check: (file, code) => hits(styles(file, code), /font-weight:\s*(?!400\b|600\b|var\(--fw-|inherit\b)[^\s;}][^;}\n]*/),
  },
  {
    id: "mitori/no-font-face",
    why: "§13.2: OS fonts only (web fonts 0 bytes)",
    applies: isStyle,
    check: (file, code) => hits(styles(file, code), /@font-face/),
  },
  {
    id: "mitori/faint-surface",
    why: "§13.2: color: var(--faint) only on --paper / --sheet surfaces (static part; the e2e probe checks computed styles)",
    applies: (f) => isStyle(f) && !/tokens\.css$/.test(f),
    check(file, code) {
      const css = styles(file, code);
      return cssRules(css)
        .filter((r) => /(^|[;\s])color:\s*var\(--faint\)/.test(r.body))
        .filter((r) => {
          const bg = /background(?:-color)?:\s*([^;]+)/.exec(r.body)?.[1]?.trim();
          return bg !== undefined && !/^(var\(--(paper|sheet)\)|transparent|none)$/.test(bg);
        })
        .map((r) => ({ line: lineOf(css, r.index), text: r.body.trim().slice(0, 80) }));
    },
  },
  {
    id: "mitori/storage-wrapper",
    why: "§12.11 / §13.2: localStorage / sessionStorage / document.cookie only in storage.ts and the head script",
    applies: (f) => isCode(f) && !/shell[\\/](storage|head)\.ts$/.test(f),
    check: (_f, code) => hits(code, /\b(localStorage|sessionStorage)\b|document\.cookie/),
  },
  {
    id: "mitori/no-direct-fetch",
    why: "§13.2: fetch( only in @mitori/client and the api layer (here shell/net, the client fallback)",
    applies: (f) => isCode(f) && !/shell[\\/]net[\\/]/.test(f),
    check: (_f, code) => hits(code, /(?<![.\w])fetch\(/),
  },
  {
    id: "mitori/no-line-components",
    why: "§12.7 / §13.2: no component per line / block inside {#each} in the code, context and block hosts",
    applies: (f) => /reader[\\/](CodeView|CodePane|ContextColumn|BlockHost|CitePeek)\.svelte$/.test(f),
    check(_f, code) {
      const out: { line: number; text: string }[] = [];
      for (const m of code.matchAll(/\{#each\b[\s\S]*?\{\/each\}/g)) {
        for (const c of m[0].matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) out.push({ line: lineOf(code, m.index + (c.index ?? 0)), text: c[0] });
      }
      return out;
    },
  },
  {
    id: "mitori/no-progressbar",
    why: "§13.2 / WEB-U-032: no role=progressbar / <progress> (counts, not percentages)",
    applies: isCode,
    check: (_f, code) => hits(code, /role=["']progressbar["']|<progress\b/),
  },
  // ---------------------------------------------------------------- WP-10a extras
  {
    id: "mitori/no-viewport-width",
    why: "§3.1 R1: widths come from the grid container (ResizeObserver), never vw (a 17 px scrollbar overflows)",
    applies: isStyle,
    check: (file, code) => hits(styles(file, code), /\b\d+(\.\d+)?vw\b/),
  },
  {
    id: "mitori/trusted-html",
    why: "§12.7: only server HTML (blocks, code, our map SVG) and the <b>/<kbd>/<code> subset reach innerHTML",
    applies: (f) => isCode(f) && !/(reader[\\/](BlockHost|CodePane|CitePeek)\.svelte|map[\\/](plan-dom|render)\.ts|shell[\\/](Rich\.svelte|rich\.ts))$/.test(f),
    check: untrustedHtml,
  },
  {
    id: "mitori/no-effect-in-store",
    why: "§12.2-5: stores hold state and derive; DOM bridges ($effect) live in Shell components",
    applies: (f) => /stores[\\/][^\\/]+\.svelte\.ts$/.test(f),
    check: (_f, code) => hits(code, /\$effect(\.pre|\.root)?\(/),
  },
  {
    id: "mitori/raw-dto-state",
    why: "§12.2-2: server DTOs are $state.raw (no deep proxies over 1,000-block arrays)",
    applies: (f) => /\.svelte(\.ts)?$/.test(f) && !isTest(f),
    check: (_f, code) =>
      hits(
        code,
        /\$state<[^>]*\b(DocOutline|SectionView|MapView|JobDetail|PaletteIndex|GenEstimate|SettingsView|WorkspaceStatus|DaemonStatus|FileContent|OutlineIndex)\b/,
      ),
  },
  {
    id: "mitori/no-console-log",
    why: "no debug logging in the shipped bundle (console.error for reported failures only)",
    applies: isCode,
    check: (_f, code) => hits(code, /console\.(log|debug|info)\(/),
  },
];

export function runRules(files: readonly { path: string; source: string }[], rules: readonly Rule[] = RULES): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    const code = f.path.endsWith(".json") ? f.source : stripComments(f.source);
    for (const r of rules) {
      if (!r.applies(f.path)) continue;
      for (const h of r.check(f.path, code)) out.push({ rule: r.id, file: f.path, ...h });
    }
  }
  return out;
}
