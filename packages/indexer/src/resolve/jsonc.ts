/** JSONC (spec §4.1): drop comments and trailing commas outside strings, then `JSON.parse`. Null on error. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j] as string)) j++;
      if (text[j] !== "}" && text[j] !== "]") out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Plain-object guard for parsed JSON. */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 1-based line of the first `"key"` occurrence after `from` (manifest facts need lines; JSON.parse loses them). */
export function jsonKeyLine(text: string, key: string, from = 0): { line: number; at: number } | null {
  const at = text.indexOf(JSON.stringify(key), from);
  if (at < 0) return null;
  let line = 1;
  for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 10) line++;
  return { line, at };
}

/**
 * Lines of the direct keys of the object stored under `section` (e.g. `"scripts"`), in source order. Works on the
 * raw text so that line numbers match the file; nested objects inside the section are skipped.
 */
export function jsonSectionKeyLines(text: string, section: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(`"${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*\\{`, "g");
  const m = re.exec(text);
  if (!m) return out;
  let i = m.index + m[0].length;
  let depth = 1;
  let line = 1;
  for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) line++;
  let expectKey = true;
  while (i < text.length && depth > 0) {
    const c = text[i] as string;
    if (c === "\n") line++;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (depth === 1 && expectKey) {
        try {
          out.set(JSON.parse(text.slice(i, j + 1)) as string, line);
        } catch {
          // malformed key: skip
        }
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) expectKey = true;
    i++;
  }
  return out;
}
