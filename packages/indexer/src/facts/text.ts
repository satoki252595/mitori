/**
 * Text-profile fact extractors (no tree): manifests (entry.node / entry.python scripts / entry.rust bins / dep.* /
 * script.*), deploy files (entry.deploy, env.files), env templates (key names only, CR idx-11), SQL schemas, docs,
 * TODO markers. Values are never captured (spec §5.1).
 */
import type { FactCandidate, FactExtractInput } from "../contract.ts";
import { baseOf, dirOf, joinPath } from "../resolve/files.ts";
import { isObj, jsonSectionKeyLines, parseJsonc } from "../resolve/jsonc.ts";
import { parseToml, type TomlDoc, tomlGet, tomlStr, tomlTable } from "../resolve/toml.ts";
import { yamlChildKeys } from "../resolve/yaml.ts";
import { candidate, ENV_NAME_RE } from "./candidate.ts";

type In = Pick<FactExtractInput, "file" | "text">;

const lineAt = (text: string, index: number): number => {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};

const firstLineMatching = (text: string, re: RegExp): number => {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => re.test(l));
  return i < 0 ? 1 : i + 1;
};

/* ------------------------------------------------------------------ package.json */

export function npmManifest(input: In): FactCandidate[] {
  const j = parseJsonc(input.text);
  if (!isObj(j)) return [];
  const out: FactCandidate[] = [];
  const top = jsonSectionKeyLinesTop(input.text);
  const dir = dirOf(input.file.path);
  const name = typeof j.name === "string" ? j.name : "";
  const bareName = name.replace(/^@[^/]+\//, "");
  // entry.node@1
  if (typeof j.bin === "string" && bareName !== "")
    out.push(candidate("entry.node@1", "entry", input, top.get("bin") ?? 1, { entry: "bin", label: bareName, target: j.bin }));
  if (isObj(j.bin)) {
    const lines = jsonSectionKeyLines(input.text, "bin");
    for (const [k, v] of Object.entries(j.bin))
      if (typeof v === "string") out.push(candidate("entry.node@1", "entry", input, lines.get(k) ?? 1, { entry: "bin", label: k, target: v }));
  }
  const exportsMain = typeof j.exports === "string" ? j.exports : isObj(j.exports) && typeof j.exports["."] === "string" ? j.exports["."] : undefined;
  const mainField = (["main", "module"] as const).find((k) => typeof j[k] === "string");
  const main = mainField ? (j[mainField] as string) : exportsMain;
  if (main !== undefined) {
    const label = joinPath(dir, main) ?? main;
    out.push(candidate("entry.node@1", "entry", input, top.get(mainField ?? "exports") ?? 1, { entry: "main", label }));
  }
  const scripts = isObj(j.scripts) ? j.scripts : {};
  const scriptLines = jsonSectionKeyLines(input.text, "scripts");
  if (typeof scripts.start === "string")
    out.push(candidate("entry.node@1", "entry", input, scriptLines.get("start") ?? 1, { entry: "script", label: "start" }));
  // script.npm@1
  for (const [k, v] of Object.entries(scripts))
    if (typeof v === "string")
      out.push(candidate("script.npm@1", "script", input, scriptLines.get(k) ?? 1, { name: k, command: v, purpose: scriptPurpose(k) }));
  // dep.npm@1
  for (const [field, dev] of [
    ["dependencies", false],
    ["peerDependencies", false],
    ["optionalDependencies", false],
    ["devDependencies", true],
  ] as const) {
    const deps = j[field];
    if (!isObj(deps)) continue;
    const lines = jsonSectionKeyLines(input.text, field);
    for (const [k, v] of Object.entries(deps))
      out.push(candidate("dep.npm@1", "dependency", input, lines.get(k) ?? 1, { ecosystem: "npm", name: k, version: typeof v === "string" ? v : "", dev }));
  }
  return out;
}

/** Lines of the top-level keys of a JSON object. */
function jsonSectionKeyLinesTop(text: string): Map<string, number> {
  const out = new Map<string, number>();
  let depth = 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") line++;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (depth === 1 && /^\s*:/.test(text.slice(j + 1, j + 8))) {
        try {
          const k = JSON.parse(text.slice(i, j + 1)) as string;
          if (!out.has(k)) out.set(k, line);
        } catch {
          // skip malformed key
        }
      }
      i = j;
    }
  }
  return out;
}

/** Script purpose from its name (spec §5.5). */
export function scriptPurpose(name: string): "build" | "run" | "test" | "lint" | "format" | "typecheck" | "other" {
  const n = name.toLowerCase();
  if (/^(build|compile|bundle)/.test(n)) return "build";
  if (/^(start|dev|serve|preview|watch)/.test(n)) return "run";
  if (/^(test|e2e|coverage|spec)/.test(n)) return "test";
  if (/^(fmt|format|prettier)/.test(n)) return "format";
  if (/^(typecheck|tsc|check-types|types)/.test(n)) return "typecheck";
  if (/lint|vet/.test(n)) return "lint";
  return "other";
}

/* ------------------------------------------------------------------ deno.json */

export function denoTasks(input: In): FactCandidate[] {
  const j = parseJsonc(input.text);
  if (!isObj(j) || !isObj(j.tasks)) return [];
  const lines = jsonSectionKeyLines(input.text, "tasks");
  const out: FactCandidate[] = [];
  for (const [k, v] of Object.entries(j.tasks)) {
    const command = typeof v === "string" ? v : isObj(v) && typeof v.command === "string" ? v.command : "";
    out.push(candidate("script.deno@1", "script", input, lines.get(k) ?? 1, { name: k, command, purpose: scriptPurpose(k) }));
  }
  return out;
}

/* ------------------------------------------------------------------ go.mod */

export function goMod(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  const lines = input.text.split("\n");
  let inBlock = false;
  lines.forEach((raw, i) => {
    const l = raw.replace(/\/\/(?!\s*indirect).*$/, "");
    if (/^\s*require\s*\(/.test(l)) {
      inBlock = true;
      return;
    }
    if (inBlock && /^\s*\)/.test(l)) {
      inBlock = false;
      return;
    }
    const m = inBlock ? /^\s*([^\s]+)\s+([^\s]+)/.exec(l) : /^\s*require\s+([^\s(]+)\s+([^\s]+)/.exec(l);
    if (!m || /\/\/\s*indirect/.test(raw)) return;
    out.push(candidate("dep.go@1", "dependency", input, i + 1, { ecosystem: "go", name: m[1] as string, version: m[2] as string, dev: false }));
  });
  return out;
}

/* ------------------------------------------------------------------ pyproject / requirements */

const PY_DEV_GROUPS = /^(dev|test|tests|testing|lint|docs|doc|typing)$/i;

function pyReqName(req: string): string | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(req);
  return m ? (m[1] as string) : null;
}

const pyReqVersion = (req: string): string => (/^\s*[A-Za-z0-9][A-Za-z0-9._-]*(\[[^\]]*\])?\s*([^;]*)/.exec(req)?.[2] ?? "").trim();

export function pyproject(input: In): FactCandidate[] {
  const doc = parseToml(input.text);
  const out: FactCandidate[] = [];
  const dep = (name: string, version: string, dev: boolean, line: number) =>
    out.push(candidate("dep.py@1", "dependency", input, line, { ecosystem: "pypi", name, version, dev }));
  const arr = (path: string, dev: boolean) => {
    const v = tomlGet(doc.root, ...path.split("."));
    if (!Array.isArray(v)) return;
    v.forEach((x, i) => {
      if (typeof x !== "string") return;
      const n = pyReqName(x);
      if (n) dep(n, pyReqVersion(x), dev, doc.lines.get(`${path}[${i}]`) ?? doc.lines.get(path) ?? 1);
    });
  };
  arr("project.dependencies", false);
  for (const g of Object.keys(tomlTable(tomlGet(doc.root, "project", "optional-dependencies")) ?? {}))
    arr(`project.optional-dependencies.${g}`, PY_DEV_GROUPS.test(g));
  for (const g of Object.keys(tomlTable(tomlGet(doc.root, "dependency-groups")) ?? {})) arr(`dependency-groups.${g}`, true);
  const poetry = (path: string, dev: boolean) => {
    for (const [k, v] of Object.entries(tomlTable(tomlGet(doc.root, ...path.split("."))) ?? {}))
      if (k !== "python") dep(k, typeof v === "string" ? v : (tomlStr(tomlGet(v, "version")) ?? ""), dev, doc.lines.get(`${path}.${k}`) ?? 1);
  };
  poetry("tool.poetry.dependencies", false);
  poetry("tool.poetry.dev-dependencies", true);
  for (const g of Object.keys(tomlTable(tomlGet(doc.root, "tool", "poetry", "group")) ?? {})) poetry(`tool.poetry.group.${g}.dependencies`, true);
  // entry.python@1 scripts
  for (const path of ["project.scripts", "tool.poetry.scripts"])
    for (const [k, v] of Object.entries(tomlTable(tomlGet(doc.root, ...path.split("."))) ?? {}))
      out.push(
        candidate("entry.python@1", "entry", input, doc.lines.get(`${path}.${k}`) ?? 1, { entry: "script", label: k, target: typeof v === "string" ? v : "" }),
      );
  // script.py@1
  for (const path of ["tool.poe.tasks", "tool.pdm.scripts"]) scriptTable(input, doc, path, out);
  for (const env of Object.keys(tomlTable(tomlGet(doc.root, "tool", "hatch", "envs")) ?? {})) scriptTable(input, doc, `tool.hatch.envs.${env}.scripts`, out);
  return out;
}

function scriptTable(input: In, doc: TomlDoc, path: string, out: FactCandidate[]): void {
  for (const [k, v] of Object.entries(tomlTable(tomlGet(doc.root, ...path.split("."))) ?? {})) {
    const command =
      typeof v === "string"
        ? v
        : Array.isArray(v)
          ? v.filter((x) => typeof x === "string").join(" && ")
          : (tomlStr(tomlGet(v, "cmd")) ?? tomlStr(tomlGet(v, "shell")) ?? "");
    out.push(candidate("script.py@1", "script", input, doc.lines.get(`${path}.${k}`) ?? 1, { name: k, command, purpose: scriptPurpose(k) }));
  }
}

export function requirementsTxt(input: In): FactCandidate[] {
  const dev = /(dev|test|lint|docs)/i.test(baseOf(input.file.path));
  const out: FactCandidate[] = [];
  input.text.split("\n").forEach((l, i) => {
    const s = l.replace(/#.*$/, "").trim();
    if (s === "" || s.startsWith("-")) return;
    const n = pyReqName(s);
    if (n) out.push(candidate("dep.py@1", "dependency", input, i + 1, { ecosystem: "pypi", name: n, version: pyReqVersion(s), dev }));
  });
  return out;
}

/* ------------------------------------------------------------------ Cargo.toml */

export function cargoManifest(input: In): FactCandidate[] {
  const doc = parseToml(input.text);
  const out: FactCandidate[] = [];
  for (const [section, dev] of [
    ["dependencies", false],
    ["build-dependencies", false],
    ["dev-dependencies", true],
  ] as const) {
    for (const [k, v] of Object.entries(tomlTable(tomlGet(doc.root, section)) ?? {})) {
      const inherited = tomlGet(v, "workspace") === true;
      const version = typeof v === "string" ? v : inherited ? "workspace" : (tomlStr(tomlGet(v, "version")) ?? (tomlStr(tomlGet(v, "path")) ? "path" : ""));
      const name = tomlStr(tomlGet(v, "package")) ?? k;
      out.push(candidate("dep.cargo@1", "dependency", input, doc.lines.get(`${section}.${k}`) ?? 1, { ecosystem: "cargo", name, version, dev }));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Makefile / justfile / Taskfile / flake.nix */

export function makefile(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  const lines = input.text.split("\n");
  lines.forEach((l, i) => {
    const m = /^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:(?![=:])/.exec(l);
    if (!m || l.includes("%") || l.startsWith("$(")) return;
    const name = m[1] as string;
    if (name.startsWith(".")) return;
    const next = lines[i + 1] ?? "";
    out.push(candidate("script.make@1", "script", input, i + 1, { name, command: next.startsWith("\t") ? next.trim() : "", purpose: scriptPurpose(name) }));
  });
  return out;
}

export function justfile(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  const lines = input.text.split("\n");
  lines.forEach((l, i) => {
    if (/^(set|alias|export|import|mod)\b/.test(l)) return;
    const m = /^@?([A-Za-z0-9_-]+)(\s+[^:=]*)?:(?!=)/.exec(l);
    if (!m) return;
    const next = lines[i + 1] ?? "";
    out.push(
      candidate("script.just@1", "script", input, i + 1, {
        name: m[1] as string,
        command: /^\s+/.test(next) ? next.trim() : "",
        purpose: scriptPurpose(m[1] as string),
      }),
    );
  });
  return out;
}

export function taskfile(input: In): FactCandidate[] {
  return yamlChildKeys(input.text, "tasks").map((k) =>
    candidate("script.task@1", "script", input, k.line, { name: k.key, command: `task ${k.key}`, purpose: scriptPurpose(k.key) }),
  );
}

export function flakeNix(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  const seen = new Set<string>();
  const re = /\b(apps|devShells|packages)((?:\.(?:"[^"]*"|\$\{[^}]*\}|[A-Za-z0-9_-]+))+)\s*=/g;
  for (const m of input.text.matchAll(re)) {
    const attrs = (m[2] as string).split(".").filter(Boolean);
    const name = (attrs[attrs.length - 1] ?? "").replace(/"/g, "");
    if (!/^[A-Za-z][\w-]*$/.test(name) || /^(x86_64|aarch64)-/.test(name)) continue;
    const kind = m[1] as string;
    const key = `${kind}.${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const command =
      kind === "devShells" ? (name === "default" ? "nix develop" : `nix develop .#${name}`) : name === "default" ? "nix run" : `nix run .#${name}`;
    out.push(
      candidate("script.nix@1", "script", input, lineAt(input.text, m.index ?? 0), {
        name: kind === "devShells" ? `devShell:${name}` : name,
        command,
        purpose: kind === "devShells" ? "other" : "run",
      }),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ deploy files: entry.deploy + env.files */

export function dockerfile(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  input.text.split("\n").forEach((l, i) => {
    const m = /^\s*(CMD|ENTRYPOINT|ENV|ARG)\s+(.*)$/i.exec(l);
    if (!m) return;
    const op = (m[1] as string).toUpperCase();
    const rest = (m[2] as string).trim();
    if (op === "ENV" || op === "ARG") {
      const names =
        op === "ARG"
          ? [rest.split("=")[0] as string]
          : /^[A-Za-z_]\w*\s+[^=]*$/.test(rest)
            ? [rest.split(/\s+/)[0] as string]
            : [...rest.matchAll(/([A-Za-z_]\w*)=/g)].map((x) => x[1] as string);
      for (const n of names) if (ENV_NAME_RE.test(n)) out.push(candidate("env.files@1", "env", input, i + 1, { name: n, hasDefault: false }));
      return;
    }
    let label = rest;
    if (rest.startsWith("[")) {
      try {
        const arr = JSON.parse(rest) as unknown[];
        label = typeof arr[0] === "string" ? arr[0] : rest;
      } catch {
        // shell form
      }
    } else label = rest.split(/\s+/)[0] ?? rest;
    out.push(candidate("entry.deploy@1", "entry", input, i + 1, { entry: "dockerfile", label }));
  });
  return out;
}

export function procfile(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  input.text.split("\n").forEach((l, i) => {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*\S/.exec(l);
    if (m) out.push(candidate("entry.deploy@1", "entry", input, i + 1, { entry: "procfile", label: m[1] as string }));
  });
  return out;
}

export function wrangler(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  if (input.file.path.endsWith(".toml")) {
    const doc = parseToml(input.text);
    const main = tomlStr(tomlGet(doc.root, "main"));
    if (main)
      out.push(
        candidate("entry.deploy@1", "entry", input, doc.lines.get("main") ?? 1, { entry: "worker", label: joinPath(dirOf(input.file.path), main) ?? main }),
      );
    for (const k of Object.keys(tomlTable(tomlGet(doc.root, "vars")) ?? {}))
      if (ENV_NAME_RE.test(k)) out.push(candidate("env.files@1", "env", input, doc.lines.get(`vars.${k}`) ?? 1, { name: k, hasDefault: false }));
    return out;
  }
  const j = parseJsonc(input.text);
  if (!isObj(j)) return out;
  if (typeof j.main === "string")
    out.push(
      candidate("entry.deploy@1", "entry", input, firstLineMatching(input.text, /"main"\s*:/), {
        entry: "worker",
        label: joinPath(dirOf(input.file.path), j.main) ?? j.main,
      }),
    );
  const vars = jsonSectionKeyLines(input.text, "vars");
  for (const [k, line] of vars) if (ENV_NAME_RE.test(k)) out.push(candidate("env.files@1", "env", input, line, { name: k, hasDefault: false }));
  return out;
}

export function serverless(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  input.text.split("\n").forEach((l, i) => {
    const m = /^\s+handler:\s*['"]?([^'"#\s]+)/.exec(l);
    if (m) out.push(candidate("entry.deploy@1", "entry", input, i + 1, { entry: "lambda", label: m[1] as string }));
  });
  return out;
}

export function compose(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  const lines = input.text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)environment\s*:\s*$/.exec(lines[i] as string);
    if (!m) continue;
    const base = (m[1] as string).length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] as string;
      if (/^\s*(#.*)?$/.test(l)) continue;
      if (l.length - l.trimStart().length <= base) break;
      const name = /^\s*-\s*([A-Za-z_]\w*)\s*(=|$)/.exec(l)?.[1] ?? /^\s*([A-Za-z_]\w*)\s*:/.exec(l)?.[1];
      if (name) out.push(candidate("env.files@1", "env", input, j + 1, { name, hasDefault: false }));
    }
  }
  return out;
}

/** `.env.example` / `.env.sample` / `.env.template`: key names only (core ENV_TEMPLATE_GLOBS, CR idx-11 / m0-12). */
export function envTemplate(input: In): FactCandidate[] {
  const out: FactCandidate[] = [];
  input.text.split("\n").forEach((l, i) => {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1];
    if (name) out.push(candidate("env.files@1", "env", input, i + 1, { name, hasDefault: false }));
  });
  return out;
}

/* ------------------------------------------------------------------ schema.sql@1 */

const SQL_SKIP = /^(PRIMARY|CONSTRAINT|UNIQUE|FOREIGN|CHECK|KEY|INDEX|FULLTEXT|SPATIAL|EXCLUDE|PERIOD|LIKE)\b/i;
const ident = (s: string) =>
  s
    .replace(/^[`"[]|[`"\]]$/g, "")
    .split(".")
    .pop()
    ?.replace(/^[`"[]|[`"\]]$/g, "") ?? s;

/** Split a parenthesized column list at top-level commas. */
function topLevelItems(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const c of body) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

export function sqlSchema(input: In): FactCandidate[] {
  // strip comments, keep offsets (line numbers) by blanking
  const text = input.text.replace(/--[^\n]*/g, (m) => " ".repeat(m.length)).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const tables = new Map<string, { line: number; fields: string[] }>();
  const createRe =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+|VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)\s*\(/gi;
  for (const m of text.matchAll(createRe)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const fields = topLevelItems(text.slice(start, i - 1))
      .map((s) => s.trim())
      .filter((s) => s !== "" && !SQL_SKIP.test(s))
      .map((s) => ident(s.split(/\s+/)[0] as string))
      .filter((s) => /^[A-Za-z_][\w$]*$/.test(s));
    const name = ident(m[1] as string);
    if (!tables.has(name)) tables.set(name, { line: lineAt(text, m.index ?? 0), fields });
  }
  for (const m of text.matchAll(
    /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([`"[\]\w.]+)\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w]+)/gi,
  )) {
    const name = ident(m[1] as string);
    const col = ident(m[2] as string);
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|INDEX|KEY)$/i.test(col)) continue;
    const t = tables.get(name) ?? { line: lineAt(text, m.index ?? 0), fields: [] };
    if (!t.fields.includes(col)) t.fields.push(col);
    tables.set(name, t);
  }
  return [...tables].map(([entity, t]) => candidate("schema.sql@1", "schema", input, t.line, { entity, source: "sql", fields: t.fields }));
}

/* ------------------------------------------------------------------ doc.existing@1 */

export function docRole(path: string): "readme" | "agents" | "claude" | "adr" | "contributing" | "architecture" | "other" {
  const b = baseOf(path);
  if (/^readme(\.|$)/i.test(b)) return "readme";
  if (b === "AGENTS.md") return "agents";
  if (b === "CLAUDE.md") return "claude";
  if (/(^|\/)(docs\/adr|docs\/decisions|adr|doc\/adr)\//i.test(path)) return "adr";
  if (/^contributing(\.|$)/i.test(b)) return "contributing";
  if (/^(architecture|design)(\.|$)/i.test(b) || /(^|\/)docs\/architecture/i.test(path)) return "architecture";
  return "other";
}

/** First ATX / setext heading (`# x` / `x\n===`), RST over/underlines, else the file name. */
export function docTitle(path: string, text: string): string {
  const lines = text.split("\n");
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) continue;
    const atx = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (atx && (atx[1] as string) !== "") return atx[1] as string;
    const next = lines[i + 1] ?? "";
    if (l.trim() !== "" && /^\s{0,3}(=+|-+|~+|\^+|\*+)\s*$/.test(next) && !/^\s*[-*+]\s/.test(l) && !/^\s*(=+|-+)\s*$/.test(l)) return l.trim();
  }
  return baseOf(path);
}

export function existingDoc(input: In): FactCandidate[] {
  if (input.file.path.startsWith(".claude/") || input.file.path.includes("/.claude/")) return [];
  const role = docRole(input.file.path);
  return [candidate("doc.existing@1", "existing_doc", input, firstHeadingLine(input.text), { role, title: docTitle(input.file.path, input.text) })];
}

function firstHeadingLine(text: string): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}#{1,6}\s+\S/.test(lines[i] as string)) return i + 1;
    if ((lines[i] as string).trim() !== "" && /^\s{0,3}(=+|-+)\s*$/.test(lines[i + 1] ?? "")) return i + 1;
  }
  return 1;
}

/* ------------------------------------------------------------------ todo.comment@1 */

const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b(?:\([^)]*\))?:?\s*(.*)$/;
const COMMENT_START = /^\s*(\/\/|#|\/\*|\*|--|<!--|;|%|')/;

/**
 * TODO markers: in comment ranges when known (tree languages pass `commentLines`), else in comment-looking lines.
 * Docs are scanned whole (a TODO in a README is a TODO).
 */
export function todos(input: In, inComment?: (index: number) => boolean): FactCandidate[] {
  const out: FactCandidate[] = [];
  const docs = input.file.class === "docs";
  const text = input.text;
  let line = 1;
  let scanned = 0;
  let lastLine = 0;
  // jump from marker to marker instead of splitting every file into lines
  for (const hit of text.matchAll(/\b(TODO|FIXME|HACK|XXX)\b/g)) {
    const at = hit.index ?? 0;
    for (let i = scanned; i < at; i++) if (text.charCodeAt(i) === 10) line++;
    scanned = at;
    if (line === lastLine) continue;
    const start = text.lastIndexOf("\n", at - 1) + 1;
    const endNl = text.indexOf("\n", at);
    const l = text.slice(start, endNl < 0 ? text.length : endNl);
    if (inComment ? !inComment(at) : !docs && !COMMENT_START.test(l) && !/\s(\/\/|#)\s/.test(l)) continue;
    const m = TODO_RE.exec(l);
    if (!m) continue;
    lastLine = line;
    const body = (m[2] as string)
      .replace(/\*\/\s*$|-->\s*$/, "")
      .trim()
      .slice(0, 120);
    out.push(candidate("todo.comment@1", "todo", input, line, { marker: m[1] as string, text: body }));
  }
  return out;
}
