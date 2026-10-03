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
    const indent = raw.length - raw.trimStart().length;
    const m = /^\s*(['"]?)([^'":#\s][^'":#]*?)\1\s*:(\s|$)/.exec(raw);
    if (!inside) {
      if (m && unquote(m[2] as string) === parentKey) {
        inside = true;
        parentIndent = indent;
      }
      continue;
    }
    if (parentKey !== null && indent <= parentIndent) {
      inside = false;
      childIndent = -1;
      if (m && unquote(m[2] as string) === parentKey) {
        inside = true;
        parentIndent = indent;
      }
      continue;
    }
    if (childIndent < 0) childIndent = indent;
    if (indent === childIndent && m) out.push({ key: unquote(m[2] as string), line: i + 1, indent });
  }
  return out;
}

/** Scalar items of the sequence under top-level key `key` (block `- x` lines or a flow `[a, b]`). */
export function yamlList(text: string, key: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(lines[i] as string);
    if (!m) continue;
    const rest = (m[1] as string).replace(/\s+#.*$/, "").trim();
    if (rest.startsWith("["))
      return rest
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(unquote)
        .filter(Boolean);
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] as string;
      if (/^\s*(#.*)?$/.test(l)) continue;
      const item = /^\s+-\s+(.*?)\s*(#.*)?$/.exec(l);
      if (!item) break;
      out.push(unquote(item[1] as string));
    }
    return out;
  }
  return out;
}
