/**
 * Line-level YAML helpers for the few places that need YAML (pnpm-workspace.yaml `packages`, compose
 * `environment:` keys, Taskfile `tasks:`). Not a YAML parser: block mappings and block/flow sequences of scalars only.
 */

export interface YamlKeyLine {
  key: string;
  line: number;
  indent: number;
}

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, "$2");

/**
 * `key:` / `"key" :` / `'key':` at the start of a (left-trimmed) line. These regexes run on untrusted lines of any
 * length, so no two quantifiers may compete for the same run of spaces (that backtracks quadratically or worse):
 * the unquoted key keeps its trailing spaces (trimmed afterwards) instead of a separate `\s*` before the colon.
 */
const KEY_RE = /^(?:"([^"]*)"[ \t]*|'([^']*)'[ \t]*|([^'":#\s][^'":#]*)):(\s|$)/;

function keyAt(line: string): { key: string; end: number } | null {
  const m = KEY_RE.exec(line);
  if (!m) return null;
  return { key: m[1] ?? m[2] ?? (m[3] as string).trimEnd(), end: (m[0] as string).length };
}

/** `- item  # comment` → `item` (a `#` starts a comment only after whitespace). */
function stripComment(s: string): string {
  const hash = s.search(/\s#/);
  return (hash < 0 ? s : s.slice(0, hash)).trim();
}

/** Direct child keys (with lines) of the block mapping under `parentKey` (top level when null). */
export function yamlChildKeys(text: string, parentKey: string | null): YamlKeyLine[] {
  const lines = text.split("\n");
  const out: YamlKeyLine[] = [];
  let inside = parentKey === null;
  let parentIndent = -1;
  let childIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (/^\s*(#.*)?$/.test(raw)) continue;
    const body = raw.trimStart();
    const indent = raw.length - body.length;
    const k = keyAt(body);
    if (!inside) {
      if (k?.key === parentKey) {
        inside = true;
        parentIndent = indent;
      }
      continue;
    }
    if (parentKey !== null && indent <= parentIndent) {
      inside = false;
      childIndent = -1;
      if (k?.key === parentKey) {
        inside = true;
        parentIndent = indent;
      }
      continue;
    }
    if (childIndent < 0) childIndent = indent;
    if (indent === childIndent && k) out.push({ key: k.key, line: i + 1, indent });
  }
  return out;
}

/** Scalar items of the sequence under top-level key `key` (block `- x` lines or a flow `[a, b]`). */
export function yamlList(text: string, key: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const k = keyAt(line);
    if (!k || k.key !== key) continue;
    const rest = stripComment(line.slice(k.end));
    if (rest.startsWith("["))
      return rest
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(unquote)
        .filter(Boolean);
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] as string;
      if (/^\s*(#.*)?$/.test(l)) continue;
      const item = /^\s+-\s+(.*)$/.exec(l);
      if (!item) break;
      out.push(unquote(stripComment(item[1] as string)));
    }
    return out;
  }
  return out;
}
