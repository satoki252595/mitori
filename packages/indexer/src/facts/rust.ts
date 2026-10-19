/** Rust fact extractors (Worker side): env.rust, cli.clap, entry.rust (fn main; bin-root check at link), test.rust. */
import type { FactCandidate, FactExtractInput } from "../contract.ts";
import { candidate, ENV_NAME_RE } from "./candidate.ts";
import { RUST } from "./queries.ts";
import { capsFor, lineOf, type Node, stringValue, type Tree } from "./tsq.ts";

const DEFAULT_METHODS = /^(unwrap_or|unwrap_or_else|unwrap_or_default|or|or_else|map_or|map_or_else)$/;

/** `env::var("X").ok().unwrap_or(…)`: a defaulting method somewhere up the method chain. */
function chainHasDefault(call: Node): boolean {
  let cur: Node = call;
  for (let i = 0; i < 8; i++) {
    const f = cur.parent;
    if (f?.type === "try_expression") return false;
    if (f?.type !== "field_expression" || f.childForFieldName("value")?.id !== cur.id) return false;
    const c = f.parent;
    if (c?.type !== "call_expression") return false;
    if (DEFAULT_METHODS.test(f.childForFieldName("field")?.text ?? "")) return true;
    cur = c;
  }
  return false;
}

export function rustEnv(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/\benv(::|!|\s*=)|option_env!/.test(input.text)) return [];
  const out: FactCandidate[] = [];
  for (const c of capsFor(tree, RUST.env)) {
    const n = c["env.name"];
    if (!n) continue;
    const name = stringValue(n);
    if (name === null || !ENV_NAME_RE.test(name)) continue;
    const call = c["env.call"] ?? c["env.macro"];
    out.push(candidate("env.rust@1", "env", input, lineOf(n), { name, hasDefault: call ? chainHasDefault(call) : false }));
  }
  // clap `#[arg(env = "X")]`
  if (/#\[arg\([^\]]*\benv\s*=/.test(input.text))
    for (const attr of tree.rootNode.descendantsOfType("attribute_item")) {
      const m = attr ? /^#\[arg\([^\]]*\benv\s*=\s*"([A-Za-z_][A-Za-z0-9_]*)"/.exec(attr.text) : null;
      if (attr && m) out.push(candidate("env.rust@1", "env", input, lineOf(attr), { name: m[1] as string, hasDefault: /default_value/.test(attr.text) }));
    }
  return out;
}

const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();

/** Attribute items directly preceding `node` (`#[derive(Parser)]`, `#[arg(long)]` …). */
function attrsBefore(node: Node): string[] {
  const out: string[] = [];
  for (
    let s = node.previousNamedSibling;
    s && (s.type === "attribute_item" || s.type === "line_comment" || s.type === "block_comment");
    s = s.previousNamedSibling
  )
    if (s.type === "attribute_item") out.push(s.text);
  return out;
}

/** Flags of the fields of a struct / struct-like variant body. */
function fieldFlags(body: Node | null): string[] {
  const flags: string[] = [];
  for (const f of body?.namedChildren ?? []) {
    if (f?.type !== "field_declaration") continue;
    const name = f.childForFieldName("name")?.text ?? "";
    for (const a of attrsBefore(f)) {
      const arg = /^#\[(?:arg|clap)\((.*)\)\]$/s.exec(a)?.[1];
      if (arg === undefined) continue;
      const long = /\blong\s*=\s*"([^"]+)"/.exec(arg)?.[1] ?? (/\blong\b/.test(arg) ? kebab(name) : null);
      const short = /\bshort\s*=\s*'(.)'/.exec(arg)?.[1] ?? (/\bshort\b(?!\s*=)/.test(arg) ? (name[0] ?? null) : null);
      if (long) flags.push(`--${long}`);
      if (short) flags.push(`-${short}`);
    }
  }
  return flags;
}

/** clap derive (`#[derive(Parser)]` + `#[derive(Subcommand)]`) and builder (`Command::new("x")` + `Arg::new(..).long("y")`). */
export function rustClap(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !input.imports.some((i) => /^(::)?clap\b/.test(i.spec))) return [];
  const out: FactCandidate[] = [];
  let prog = "";
  const rootFlags: { line: number; flags: string[] }[] = [];
  const subs: { name: string; line: number; flags: string[] }[] = [];
  for (const item of tree.rootNode.descendantsOfType(["struct_item", "enum_item"])) {
    if (!item) continue;
    const attrs = attrsBefore(item);
    const derive = attrs.find((a) => /^#\[derive\(/.test(a)) ?? "";
    if (/\bParser\b/.test(derive)) {
      prog = /#\[(?:command|clap)\([^\]]*\bname\s*=\s*"([^"]+)"/.exec(attrs.join("\n"))?.[1] ?? prog;
      const flags = fieldFlags(item.childForFieldName("body"));
      if (flags.length > 0) rootFlags.push({ line: lineOf(item), flags });
    } else if (/\bSubcommand\b/.test(derive) && item.type === "enum_item") {
      for (const v of item.childForFieldName("body")?.namedChildren ?? []) {
        if (v?.type !== "enum_variant") continue;
        const explicit = /#\[(?:command|clap)\([^\]]*\bname\s*=\s*"([^"]+)"/.exec(attrsBefore(v).join("\n"))?.[1];
        subs.push({ name: explicit ?? kebab(v.childForFieldName("name")?.text ?? ""), line: lineOf(v), flags: fieldFlags(v.childForFieldName("body")) });
      }
    }
  }
  const withProg = (name: string) => (prog === "" ? name : `${prog} ${name}`);
  for (const s of subs)
    out.push(candidate("cli.clap@1", "cli", input, s.line, { command: withProg(s.name), flags: s.flags, framework: "clap", prog }, ["import:clap"]));
  if (subs.length === 0)
    for (const r of rootFlags)
      out.push(candidate("cli.clap@1", "cli", input, r.line, { command: prog, flags: r.flags, framework: "clap", prog }, ["import:clap"]));
  // builder: Command::new("x") chains
  for (const call of tree.rootNode.descendantsOfType("call_expression")) {
    const fn = call?.childForFieldName("function");
    if (
      !call ||
      fn?.type !== "scoped_identifier" ||
      !/^(Command|App|SubCommand)$/.test(fn.childForFieldName("path")?.text ?? "") ||
      fn.childForFieldName("name")?.text !== "new"
    )
      continue;
    const name = stringValue(call.childForFieldName("arguments")?.namedChildren[0]);
    if (name === null) continue;
    const flags: string[] = [];
    let cur: Node = call;
    for (let i = 0; i < 64; i++) {
      const fe = cur.parent;
      const c = fe?.parent;
      if (fe?.type !== "field_expression" || c?.type !== "call_expression") break;
      if (fe.childForFieldName("field")?.text === "arg") {
        const t = c.childForFieldName("arguments")?.text ?? "";
        const long = /\.long\(\s*"([^"]+)"/.exec(t)?.[1];
        if (long) flags.push(`--${long}`);
      }
      cur = c;
    }
    out.push(candidate("cli.clap@1", "cli", input, lineOf(call), { command: name, flags, framework: "clap", prog: name, builder: true }, ["import:clap"]));
  }
  return out;
}

/** `use axum::…` / `use rmcp::…` / `use actix_web::…` (specifiers use `::` separators). */
function importsCrate(input: FactExtractInput, name: string): boolean {
  return input.imports.some((i) => i.spec === name || i.spec.startsWith(`${name}::`));
}

const AXUM_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "options", "trace", "any"]);
const ACTIX_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "options"]);

/** Last segment of a handler path (`s.handleX`, `crate::routes::logo` → the name `symbolAt` can stamp). */
function handlerName(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "identifier") return n.text;
  if (n.type === "field_expression") return n.childForFieldName("field")?.text ?? null;
  if (n.type === "scoped_identifier") return n.childForFieldName("name")?.text ?? null;
  return null;
}

function callArgs(call: Node): Node[] {
  return (call.childForFieldName("arguments")?.namedChildren ?? []).filter((x): x is Node => x !== null);
}

/**
 * axum routes: `.route("/p", get(h))` (incl. chained `get(a).post(b)`) and `.nest("/prefix", router)`. A nest prefix
 * is an entry prefix, not a full route: it is recorded with method `ANY` so the seeds can start there. Gated on an
 * `axum` import like the other detectors.
 */
export function rustAxumRoutes(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/\.(route|nest)\s*\(/.test(input.text) || !importsCrate(input, "axum")) return [];
  const out: FactCandidate[] = [];
  const push = (line: number, method: string, pattern: string, handler?: string) =>
    out.push(
      candidate("route.axum@1", "route", input, line, { method, pattern, framework: "axum", ...(handler ? { handler, handlers: [handler] } : {}) }, [
        "import:axum",
      ]),
    );
  /** Method calls of a `get(h).post(i)` chain, innermost first. */
  const chain = (n: Node | null | undefined, found: { method: string; handler: string | null }[]): void => {
    if (n?.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    const args = callArgs(n);
    if (fn?.type === "identifier" && AXUM_METHODS.has(fn.text)) found.push({ method: fn.text.toUpperCase(), handler: handlerName(args[0]) });
    else if (fn?.type === "scoped_identifier" && AXUM_METHODS.has(fn.childForFieldName("name")?.text ?? "")) {
      found.push({ method: (fn.childForFieldName("name")?.text ?? "any").toUpperCase(), handler: handlerName(args[0]) });
    } else if (fn?.type === "field_expression" && AXUM_METHODS.has(fn.childForFieldName("field")?.text ?? "")) {
      found.push({ method: (fn.childForFieldName("field")?.text ?? "any").toUpperCase(), handler: handlerName(args[0]) });
      chain(fn.childForFieldName("value"), found);
    }
  };
  for (const call of tree.rootNode.descendantsOfType("call_expression")) {
    if (!call) continue;
    const fn = call.childForFieldName("function");
    if (fn?.type !== "field_expression") continue;
    const kind = fn.childForFieldName("field")?.text;
    if (kind !== "route" && kind !== "nest") continue;
    const args = callArgs(call);
    const pattern = stringValue(args[0]);
    if (pattern === null || !pattern.startsWith("/")) continue;
    const line = args[0] ? lineOf(args[0] as Node) : lineOf(call);
    if (kind === "nest") {
      push(line, "ANY", pattern, handlerName(args[1]) ?? undefined);
      continue;
    }
    const found: { method: string; handler: string | null }[] = [];
    chain(args[1], found);
    for (const m of found) push(line, m.method, pattern, m.handler ?? undefined);
  }
  return out;
}

/** Attribute items directly preceding `node` as nodes (line numbers for the defining attribute). */
function attrNodesBefore(node: Node): Node[] {
  const out: Node[] = [];
  for (
    let s = node.previousNamedSibling;
    s && (s.type === "attribute_item" || s.type === "line_comment" || s.type === "block_comment");
    s = s.previousNamedSibling
  )
    if (s.type === "attribute_item") out.push(s);
  return out;
}

/**
 * actix-web routes: `#[get("/p")]` et al (incl. `#[route("/p", method = "GET", …)]`) on functions and
 * `web::resource("/p").route(web::get().to(h))` chains (`App::new().route(…)` has the same shape). A resource
 * without a method call is `ANY`. Gated on an `actix_web` import.
 */
export function rustActixRoutes(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/#\[(get|post|put|delete|patch|head|options|route)\b|web::resource\s*\(/.test(input.text)) return [];
  if (!importsCrate(input, "actix_web")) return [];
  const out: FactCandidate[] = [];
  const push = (line: number, method: string, pattern: string, handler?: string) =>
    out.push(
      candidate("route.actix@1", "route", input, line, { method, pattern, framework: "actix", ...(handler ? { handler, handlers: [handler] } : {}) }, [
        "import:actix-web",
      ]),
    );
  for (const fn of tree.rootNode.descendantsOfType("function_item")) {
    if (!fn) continue;
    const name = fn.childForFieldName("name")?.text;
    if (!name) continue;
    for (const a of attrNodesBefore(fn)) {
      let m = /^#\[(get|post|put|delete|patch|head|options)\("([^"]+)"\)]/.exec(a.text);
      if (m && (m[2] as string).startsWith("/")) {
        push(lineOf(a), (m[1] as string).toUpperCase(), m[2] as string, name);
        continue;
      }
      m = /^#\[route\("([^"]+)"(.*)\)]$/.exec(a.text);
      if (m && (m[1] as string).startsWith("/")) {
        const methods = [...(m[2] as string).matchAll(/method\s*=\s*"([A-Za-z]+)"/g)].map((x) => (x[1] as string).toUpperCase());
        for (const method of methods.length > 0 ? methods : ["ANY"]) push(lineOf(a), method, m[1] as string, name);
      }
    }
  }
  for (const call of tree.rootNode.descendantsOfType("call_expression")) {
    if (!call) continue;
    const fn = call.childForFieldName("function");
    const args = callArgs(call);
    if (fn?.type === "scoped_identifier" && fn.childForFieldName("path")?.text === "web" && fn.childForFieldName("name")?.text === "resource") {
      // a resource chained into `.route(…)` is covered by that call; a bare one is an entry prefix
      if (call.parent?.type === "field_expression") continue;
      const pattern = stringValue(args[0]);
      if (pattern?.startsWith("/")) push(lineOf(args[0] as Node), "ANY", pattern);
      continue;
    }
    if (fn?.type !== "field_expression" || fn.childForFieldName("field")?.text !== "route") continue;
    // the pattern is the first argument (`App::new().route(…)`) or sits on the `web::resource(…)` the call is
    // chained onto (through further `.route` calls)
    const direct = args[0] !== undefined && (stringValue(args[0]) ?? "").startsWith("/") ? args[0] : null;
    const res = direct ?? resourcePattern(fn.childForFieldName("value"));
    const pattern = res ? (stringValue(res) as string) : null;
    if (pattern === null) continue;
    const line = lineOf(direct ?? call);
    const to = direct ? args[1] : args[0];
    const toFn = to?.type === "call_expression" ? to.childForFieldName("function") : null;
    const inner = toFn?.type === "field_expression" && toFn.childForFieldName("field")?.text === "to" ? toFn.childForFieldName("value") : null;
    const web = inner?.type === "call_expression" ? inner.childForFieldName("function") : null;
    const webName = web?.type === "scoped_identifier" && web.childForFieldName("path")?.text === "web" ? web.childForFieldName("name")?.text : null;
    if (webName && ACTIX_METHODS.has(webName)) push(line, webName.toUpperCase(), pattern, handlerName(callArgs(to as Node)[0]) ?? undefined);
    else push(line, "ANY", pattern);
  }
  return out;
}

/**
 * Pattern of the `web::resource("…")` a `.route(…)` call is chained onto, through further `.route` calls
 * (`resource("/p").route(A).route(B)`: the outer call's receiver is the inner `.route` call).
 */
function resourcePattern(n: Node | null | undefined): Node | null {
  if (n?.type !== "call_expression") return null;
  const fn = n.childForFieldName("function");
  if (fn?.type === "scoped_identifier" && fn.childForFieldName("path")?.text === "web" && fn.childForFieldName("name")?.text === "resource") {
    const p = callArgs(n)[0];
    return p !== undefined && (stringValue(p) ?? "").startsWith("/") ? p : null;
  }
  if (fn?.type === "field_expression") return resourcePattern(fn.childForFieldName("value"));
  return null;
}

/**
 * MCP tool registrations (rmcp): `#[tool(…)]` on a function. The tool name is `name = "…"` when given, else the
 * function name; the handler is the function itself. `#[tool_router]` / `#[tool_handler]` mark the router, not a
 * tool, and stay out. Gated on an `rmcp` import.
 */
export function rustMcpTools(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/#\[tool[([]/.test(input.text) || !importsCrate(input, "rmcp")) return [];
  const out: FactCandidate[] = [];
  for (const fn of tree.rootNode.descendantsOfType("function_item")) {
    if (!fn) continue;
    const name = fn.childForFieldName("name")?.text;
    if (!name) continue;
    for (const a of attrNodesBefore(fn)) {
      if (!/^#\[tool[([]/.test(a.text)) continue;
      const explicit = /name\s*=\s*"([^"]+)"/.exec(a.text)?.[1];
      out.push(
        candidate("route.mcp@1", "route", input, lineOf(fn), { method: "TOOL", pattern: explicit ?? name, framework: "mcp", handler: name, handlers: [name] }, [
          "import:rmcp",
        ]),
      );
      break;
    }
  }
  return out;
}

export function rustEntry(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/\bfn\s+main\s*\(/.test(input.text)) return [];
  return capsFor(tree, RUST.entry)
    .filter((c) => c["entry.main"])
    .map((c) => candidate("entry.rust@1", "entry", input, lineOf(c["entry.main"] as Node), { entry: "main", label: input.file.path }));
}

export function rustTests(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (!/#\[(\w+::)?(test|rstest)\b/.test(input.text)) return [];
  const out: FactCandidate[] = [];
  for (const fn of tree.rootNode.descendantsOfType("function_item")) {
    if (!fn) continue;
    if (!attrsBefore(fn).some((a) => /^#\[(?:[a-z_]+::)?(test|rstest)\b/.test(a))) continue;
    const name = fn.childForFieldName("name")?.text;
    if (name) out.push(candidate("test.rust@1", "test", input, lineOf(fn), { name }));
  }
  return out;
}
