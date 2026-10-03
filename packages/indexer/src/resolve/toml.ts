/**
 * Minimal TOML reader (spec §4.1 [仮]): tables, arrays of tables, dotted / quoted keys, basic + literal +
 * multi-line strings, numbers, booleans, dates (kept as strings), arrays and inline tables. Never throws: a line it
 * cannot read is skipped. `lines` maps a key path (`a.b`, array elements `a.b[2]`) to its 1-based line.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export interface TomlDoc {
  root: TomlTable;
  lines: Map<string, number>;
}

/**
 * Tables have no prototype: keys come from untrusted repo files, and `[__proto__]` / `__proto__.x = …` on a plain
 * object would walk into `Object.prototype` and pollute every object of the process.
 */
const newTable = (): TomlTable => Object.create(null) as TomlTable;

class Cursor {
  i = 0;
  line = 1;
  constructor(readonly s: string) {}
  peek(o = 0): string {
    return this.s[this.i + o] ?? "";
  }
  next(): string {
    const c = this.s[this.i++] ?? "";
    if (c === "\n") this.line++;
    return c;
  }
  eof(): boolean {
    return this.i >= this.s.length;
  }
  startsWith(t: string): boolean {
    return this.s.startsWith(t, this.i);
  }
  /** Skip spaces/tabs (and, when `nl`, newlines + comments). */
  ws(nl = false): void {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r") this.next();
      else if (nl && c === "\n") this.next();
      else if (nl && c === "#") this.toEol();
      else return;
    }
  }
  toEol(): void {
    while (!this.eof() && this.peek() !== "\n") this.next();
  }
}

const isBare = (c: string) => /[A-Za-z0-9_-]/.test(c);

function readKey(c: Cursor): string[] | null {
  const parts: string[] = [];
  for (;;) {
    c.ws();
    const ch = c.peek();
    if (ch === '"' || ch === "'") {
      const s = readString(c);
      if (s === null) return null;
      parts.push(s);
    } else {
      let k = "";
      while (isBare(c.peek())) k += c.next();
      if (k === "") return null;
      parts.push(k);
    }
    c.ws();
    if (c.peek() !== ".") return parts;
    c.next();
  }
}

function readString(c: Cursor): string | null {
  const q = c.peek();
  const multi = c.startsWith(q.repeat(3));
  c.i += multi ? 3 : 1;
  if (multi && c.peek() === "\n") c.next();
  let out = "";
  for (;;) {
    if (c.eof()) return null;
    if (multi ? c.startsWith(q.repeat(3)) : c.peek() === q) {
      c.i += multi ? 3 : 1;
      return out;
    }
    const ch = c.next();
    if (ch === "\n" && !multi) return null;
    if (ch === "\\" && q === '"') {
      const e = c.next();
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", b: "\b", f: "\f" };
      if (e in map) out += map[e];
      else if (e === "u" || e === "U") {
        const n = e === "u" ? 4 : 8;
        const hex = c.s.slice(c.i, c.i + n);
        c.i += n;
        const cp = Number.parseInt(hex, 16);
        out += Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
      } else if (e === "\n" && multi) c.ws(true);
      else out += e;
    } else out += ch;
  }
}

/** Nesting depth of arrays / inline tables accepted (deeper input is unreadable, not a stack overflow). */
const MAX_DEPTH = 64;

function readValue(c: Cursor, lines: Map<string, number>, path: string, depth = 0): TomlValue | null {
  c.ws();
  const ch = c.peek();
  if ((ch === "[" || ch === "{") && depth >= MAX_DEPTH) return null;
  if (ch === '"' || ch === "'") return readString(c);
  if (ch === "[") {
    c.next();
    const arr: TomlValue[] = [];
    for (;;) {
      c.ws(true);
      if (c.peek() === "]") {
        c.next();
        return arr;
      }
      if (c.eof()) return null;
      const at = c.line;
      const v = readValue(c, lines, `${path}[${arr.length}]`, depth + 1);
      if (v === null) return null;
      lines.set(`${path}[${arr.length}]`, at);
      arr.push(v);
      c.ws(true);
      if (c.peek() === ",") c.next();
    }
  }
  if (ch === "{") {
    c.next();
    const t = newTable();
    for (;;) {
      c.ws();
      if (c.peek() === "}") {
        c.next();
        return t;
      }
      const key = readKey(c);
      if (!key) return null;
      c.ws();
      if (c.next() !== "=") return null;
      const v = readValue(c, lines, `${path}.${key.join(".")}`, depth + 1);
      if (v === null) return null;
      setPath(t, key, v);
      c.ws();
      if (c.peek() === ",") c.next();
    }
  }
  let raw = "";
  while (!c.eof() && !/[,\]}\n#]/.test(c.peek())) raw += c.next();
  raw = raw.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^[+-]?(\d[\d_]*)(\.\d[\d_]*)?([eE][+-]?\d+)?$/.test(raw)) return Number(raw.replaceAll("_", ""));
  return raw === "" ? null : raw;
}

function setPath(t: TomlTable, key: readonly string[], v: TomlValue): void {
  let cur = t;
  for (const k of key.slice(0, -1)) {
    const next = cur[k];
    if (next === undefined || typeof next !== "object" || Array.isArray(next)) cur[k] = newTable();
    cur = cur[k] as TomlTable;
  }
  cur[key[key.length - 1] as string] = v;
}

function tableAt(root: TomlTable, key: readonly string[], arrayItem: boolean): TomlTable {
  let cur = root;
  key.forEach((k, idx) => {
    const last = idx === key.length - 1;
    let next = cur[k];
    if (last && arrayItem) {
      if (!Array.isArray(next)) cur[k] = next = [];
      const item = newTable();
      (next as TomlValue[]).push(item);
      cur = item;
      return;
    }
    if (Array.isArray(next)) {
      const tail = next[next.length - 1];
      if (tail && typeof tail === "object" && !Array.isArray(tail)) {
        cur = tail;
        return;
      }
    }
    if (next === undefined || typeof next !== "object" || Array.isArray(next)) cur[k] = next = newTable();
    cur = next as TomlTable;
  });
  return cur;
}

/** Parse TOML text (best effort). */
export function parseToml(text: string): TomlDoc {
  const root = newTable();
  const lines = new Map<string, number>();
  const c = new Cursor(text);
  let table = root;
  let prefix = "";
  const counts = new Map<string, number>();
  while (!c.eof()) {
    c.ws(true);
    if (c.eof()) break;
    const lineStart = c.line;
    if (c.peek() === "[") {
      const arrayItem = c.startsWith("[[");
      c.i += arrayItem ? 2 : 1;
      const key = readKey(c);
      c.toEol();
      if (!key) continue;
      table = tableAt(root, key, arrayItem);
      const base = key.join(".");
      if (arrayItem) {
        const n = counts.get(base) ?? 0;
        counts.set(base, n + 1);
        prefix = `${base}[${n}]`;
      } else prefix = base;
      lines.set(prefix, lineStart);
      continue;
    }
    const key = readKey(c);
    c.ws();
    if (!key || c.peek() !== "=") {
      c.toEol();
      continue;
    }
    c.next();
    const full = prefix === "" ? key.join(".") : `${prefix}.${key.join(".")}`;
    const v = readValue(c, lines, full);
    if (v !== null) {
      setPath(table, key, v);
      lines.set(full, lineStart);
    }
    c.toEol();
  }
  return { root, lines };
}

/** Typed accessors (TOML values are untyped). */
export function tomlGet(t: TomlValue | undefined, ...path: string[]): TomlValue | undefined {
  let cur: TomlValue | undefined = t;
  for (const k of path) {
    if (cur === undefined || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function tomlStr(v: TomlValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function tomlTable(v: TomlValue | undefined): TomlTable | undefined {
  return v !== undefined && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}

export function tomlStrings(v: TomlValue | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
