/** TS / JS fact extractors (Worker side): route.express, route.hono, env.js, cli.commander, cli.registry, test.js. */
import type { FactCandidate, FactEvidence, FactExtractInput } from "../contract.ts";
import { candidate, ENV_NAME_RE } from "./candidate.ts";
import { JS } from "./queries.ts";
import { type Caps, capsFor, handlerNames, lineOf, type Node, patternOf, stringValue, type Tree } from "./tsq.ts";

/** `.get("/x"` / `` .post(`/x `` / `.on("GET", "/x"` — the route query only runs on files that have one. */
const ROUTE_HINT = /\.(?:get|post|put|patch|delete|options|head|all)\s*\(\s*["'`][/*]|\.on\s*\(\s*["'`][A-Za-z]+["'`]\s*,\s*["'`][/*]/;
const REGISTRY_KEYS = /\b(name|command|cmd)\s*:\s*["'`]/;
const REGISTRY_FNS = /\b(handler|run|action|fn)\s*:\s*[A-Za-z_$]/;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "all"]);

/** `import x from "<pkg>"` / `require("<pkg>")` evidence for a set of package names. */
function importEvidence(input: FactExtractInput, pkgs: readonly string[]): FactEvidence[] {
  const out: FactEvidence[] = [];
  for (const p of pkgs) if (input.imports.some((i) => i.spec === p || i.spec.startsWith(`${p}/`))) out.push(`import:${p}`);
  return out;
}

function bindings(all: readonly Caps[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of all) {
    const n = c["bind.name"];
    const fn = c["bind.fn"];
    if (n && fn && !out.has(n.text)) out.set(n.text, fn.text.replace(/\s+/g, ""));
  }
  return out;
}

const routeCache = new WeakMap<Tree, FactCandidate[]>();

/**
 * Framework of a route candidate from in-file evidence: the receiver's binding decides, then the file's imports.
 * `null` = undetermined (express may still claim it through the manifest at link time, spec §5.2).
 */
export function jsRouteFramework(evidence: readonly string[]): "hono" | "express" | null {
  // `bind:` holds the callee / constructor of the receiver's initializer (`Hono`, `express`, `express.Router`)
  const bind = evidence.find((e) => e.startsWith("bind:"))?.slice(5) ?? "";
  if (/^(Hono|OpenAPIHono)$/.test(bind)) return "hono";
  if (/^(express|express\.Router|Router)$/.test(bind)) return "express";
  if (bind !== "") return null;
  const hono = evidence.some((e) => e === "import:hono" || e === "import:@hono/zod-openapi");
  const express = evidence.includes("import:express");
  return hono && !express ? "hono" : express && !hono ? "express" : null;
}

/** Route candidates of one framework (`route.hono@1` / `route.express@1`). */
export function jsRoutes(input: FactExtractInput, tree: Tree, fw: "hono" | "express"): FactCandidate[] {
  const all = routeCache.get(tree) ?? jsRouteCandidates(input, tree);
  routeCache.set(tree, all);
  const out: FactCandidate[] = [];
  for (const c of all) {
    const got = jsRouteFramework(c.evidence);
    const recv = c.evidence.find((e) => e.startsWith("recv:"))?.slice(5) ?? "";
    if (got === fw || (fw === "express" && got === null && /^(app|router|api)$/.test(recv) && !c.evidence.some((e) => e.startsWith("bind:"))))
      out.push({ ...c, detector: `route.${fw}@1`, data: { ...c.data, framework: fw } });
  }
  return out;
}

function jsRouteCandidates(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !ROUTE_HINT.test(input.text)) return [];
  const all = capsFor(tree, JS.route);
  if (all.length === 0) return [];
  const binds = bindings(capsFor(tree, JS.binds));
  const ev = importEvidence(input, ["express", "hono", "@hono/zod-openapi", "fastify", "koa-router", "@koa/router"]);
  const out: FactCandidate[] = [];
  for (const c of all) {
    const call = c.route;
    const methodNode = c["route.method"];
    if (!call || !methodNode) continue;
    const name = methodNode.text;
    const args = call.childForFieldName("arguments")?.namedChildren.filter((x): x is Node => x !== null) ?? [];
    let method: string;
    let pathNode: Node | undefined;
    let handlerNode: Node | undefined;
    if (name === "on") {
      const m = stringValue(args[0]);
      if (m === null) continue;
      method = m.toUpperCase();
      pathNode = args[1];
      handlerNode = args[args.length - 1];
    } else if (HTTP_METHODS.has(name)) {
      method = name === "all" ? "ANY" : name.toUpperCase();
      pathNode = args[0];
      handlerNode = args.length > 1 ? args[args.length - 1] : undefined;
    } else continue; // use / route / basePath are mounts (prefixes are kept as written, fixtures/truth/README.md)
    const p = patternOf(pathNode);
    if (!p || !/^[/*]/.test(p.pattern)) continue;
    const recvNode = c["route.recv"];
    const recv = recvNode?.text ?? "";
    const evidence: FactEvidence[] = [...ev, `recv:${recv}`];
    const bound = binds.get(recv);
    if (bound !== undefined) evidence.push(`bind:${bound}`);
    // `list`, `ctrl.list`, `wrap(list)` → list, `makeHandler(deps)` → makeHandler (gen #4c)
    const handlers = handlerNames(handlerNode);
    out.push(
      candidate(
        "route.js@1",
        "route",
        input,
        lineOf(call),
        { method, pattern: p.pattern, ...(p.dynamic ? { dynamic: true } : {}), ...(handlers.length > 0 ? { handler: handlers[0], handlers } : {}) },
        evidence,
      ),
    );
  }
  return out;
}

/**
 * MCP tool registrations (`server.tool("name", …)` / `server.registerTool("name", …)`, the `@modelcontextprotocol/sdk`
 * `McpServer` API). The tool name is the first (string) argument; the handler is the last one when it names a
 * function (`registerTool` often passes an inline closure instead). Single-object forms (`registerTool(def)`) carry
 * no name and stay out.
 */
export function jsMcpTools(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/\.(tool|registerTool)\s*\(/.test(input.text)) return [];
  const ev = importEvidence(input, ["@modelcontextprotocol/sdk"]);
  if (ev.length === 0) return [];
  const out: FactCandidate[] = [];
  for (const c of capsFor(tree, JS.mcp)) {
    const call = c.mcp;
    const nameNode = c["mcp.name"];
    if (!call || !nameNode) continue;
    const name = stringValue(nameNode);
    if (name === null || name === "") continue;
    const args = call.childForFieldName("arguments")?.namedChildren.filter((x): x is Node => x !== null) ?? [];
    const handlers = args.length > 1 ? handlerNames(args[args.length - 1]) : [];
    const recv = c["mcp.recv"]?.text ?? "";
    out.push(
      candidate(
        "route.mcp@1",
        "route",
        input,
        lineOf(call),
        { method: "TOOL", pattern: name, framework: "mcp", ...(handlers.length > 0 ? { handler: handlers[0], handlers } : {}) },
        [...ev, `recv:${recv}`],
      ),
    );
  }
  return out;
}

/** True when `node` is the left operand of `??` / `||` (a default is visible in the same expression). */
function hasDefaultAt(node: Node): boolean {
  let cur: Node = node;
  for (let i = 0; i < 3; i++) {
    const p = cur.parent;
    if (!p) return false;
    if (p.type === "binary_expression") {
      const op = p.childForFieldName("operator")?.text;
      return (op === "??" || op === "||") && p.childForFieldName("left")?.id === cur.id;
    }
    if (p.type !== "parenthesized_expression" && p.type !== "as_expression" && p.type !== "non_null_expression") return false;
    cur = p;
  }
  return false;
}

/** Code node at a text offset, or null inside a comment / string (the text scan below finds candidates only). */
function codeNodeAt(tree: Tree, index: number, types: readonly string[]): Node | null {
  const n = tree.rootNode.descendantForIndex(index);
  return n && types.includes(n.type) ? n : null;
}

const ENV_SCAN = [
  // process.env.X / Bun.env.X / import.meta.env.X (offset of the property name)
  { re: /\b(?:process|Bun|import\.meta)\.env\.([A-Za-z_$][\w$]*)/g, node: ["property_identifier"] },
  // process.env["X"] (offset of the string)
  { re: /\bprocess\.env\[\s*((["'`])[^"'`]*\2)\s*\]/g, node: ["string_fragment", "string"] },
  // Deno.env.get("X")
  { re: /\bDeno\.env\.get\(\s*((["'`])[^"'`]*\2)/g, node: ["string_fragment", "string"] },
] as const;

export function jsEnv(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/\b(process|Bun|Deno)\.env\b|\bimport\.meta\.env\b/.test(input.text)) return [];
  const out: FactCandidate[] = [];
  const push = (name: string, line: number, hasDefault: boolean) => {
    if (ENV_NAME_RE.test(name)) out.push(candidate("env.js@1", "env", input, line, { name, hasDefault }));
  };
  for (const { re, node } of ENV_SCAN)
    for (const m of input.text.matchAll(re)) {
      // the name ends the property form and is the only quoted part of the others: search from the right (a
      // short name such as `e` also occurs inside `process`)
      const at = (m.index ?? 0) + (m[0] as string).lastIndexOf(m[1] as string) + (node[0] === "property_identifier" ? 0 : 1);
      let n = codeNodeAt(tree, at, node);
      if (!n) continue;
      if (n.type === "string_fragment") n = n.parent ?? n;
      const name = n.type === "string" ? stringValue(n) : n.text;
      if (name === null) continue;
      const expr = n.parent?.type === "arguments" ? (n.parent.parent ?? n) : (n.parent ?? n);
      push(name, lineOf(n), hasDefaultAt(expr));
    }
  // const { A, B = "x" } = process.env
  for (const m of input.text.matchAll(/=\s*process\.env\b(?!\s*[.[])/g)) {
    const proc = codeNodeAt(tree, (m.index ?? 0) + (m[0] as string).indexOf("process"), ["identifier"]);
    const decl = proc?.parent?.parent;
    const pat = decl?.type === "variable_declarator" ? decl.childForFieldName("name") : null;
    if (pat?.type !== "object_pattern") continue;
    for (const prop of pat.namedChildren) {
      if (!prop) continue;
      if (prop.type === "shorthand_property_identifier_pattern") push(prop.text, lineOf(prop), false);
      else if (prop.type === "object_assignment_pattern") {
        const left = prop.childForFieldName("left");
        if (left) push(left.text, lineOf(prop), true);
      } else if (prop.type === "pair_pattern") {
        const key = prop.childForFieldName("key");
        if (key)
          push(key.type === "string" ? (stringValue(key) ?? key.text) : key.text, lineOf(prop), prop.childForFieldName("value")?.type === "assignment_pattern");
      }
    }
  }
  return out;
}

/** Root object of a call chain (`program.command("x").option(…)` → `program`). */
function chainRoot(call: Node): Node | null {
  let cur: Node | null = call;
  for (let i = 0; cur && i < 64; i++) {
    if (cur.type === "call_expression") cur = cur.childForFieldName("function");
    else if (cur.type === "member_expression") cur = cur.childForFieldName("object");
    else return cur;
  }
  return null;
}

const flagsOf = (spec: string): string[] => spec.split(/[\s,|]+/).filter((s) => /^--?[A-Za-z0-9]/.test(s));

export function jsCommander(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const ev = importEvidence(input, ["commander"]);
  if (ev.length === 0) return [];
  const all = capsFor(tree, JS.commander);
  // program name: `new Command("x")` or `.name("x")` in the binding of the chain root
  const progs = new Map<string, string>();
  for (const decl of tree.rootNode.descendantsOfType("variable_declarator")) {
    const id = decl?.childForFieldName("name");
    const value = decl?.childForFieldName("value");
    if (!id || !value || !/\bCommand\s*\(/.test(value.text)) continue;
    const name = /\.name\(\s*["'`]([^"'`]+)["'`]/.exec(value.text)?.[1] ?? /new\s+Command\(\s*["'`]([^"'`]+)["'`]/.exec(value.text)?.[1];
    progs.set(id.text, name ?? "");
  }
  const out: FactCandidate[] = [];
  for (const c of all) {
    const cmdCall = c["cli.cmd"];
    const arg = c["cli.arg"];
    if (!cmdCall || !arg) continue;
    const word = (stringValue(arg) ?? "").trim().split(/\s+/)[0] ?? "";
    if (word === "" || word.startsWith("<") || word.startsWith("[")) continue;
    const root = chainRoot(cmdCall);
    const rootName = root?.type === "identifier" ? root.text : "";
    const evidence: FactEvidence[] = [...ev];
    if (progs.has(rootName) || root?.type === "new_expression") evidence.push("bind:Command");
    else if (rootName === "program") evidence.push("recv:program");
    else continue;
    // walk up the chain collecting .option()/.requiredOption() flags until the next .command()
    const flags: string[] = [];
    let cur: Node = cmdCall;
    for (let i = 0; i < 64; i++) {
      const member = cur.parent;
      const call = member?.parent;
      if (member?.type !== "member_expression" || call?.type !== "call_expression") break;
      const prop = member.childForFieldName("property")?.text;
      if (prop === "command") break;
      if (prop === "option" || prop === "requiredOption") flags.push(...flagsOf(stringValue(call.childForFieldName("arguments")?.namedChildren[0]) ?? ""));
      cur = call;
    }
    const prog = progs.get(rootName) ?? "";
    out.push(
      candidate("cli.commander@1", "cli", input, lineOf(arg), { command: prog === "" ? word : `${prog} ${word}`, flags, framework: "commander" }, evidence),
    );
  }
  return out;
}

/**
 * `{name: "x", handler: fn}` table entries. A linear walk over object literals (a two-pair query pattern is quadratic
 * in the pairs of every object and dominated S1 on react).
 */
export function jsRegistry(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !REGISTRY_KEYS.test(input.text) || !REGISTRY_FNS.test(input.text)) return [];
  const out: FactCandidate[] = [];
  for (const obj of tree.rootNode.descendantsOfType("object")) {
    if (!obj) continue;
    let reg: Node | null = null;
    let handler = false;
    for (const pair of obj.namedChildren) {
      if (pair?.type !== "pair") continue;
      const key = pair.childForFieldName("key");
      const value = pair.childForFieldName("value");
      if (key?.type !== "property_identifier" || !value) continue;
      if (/^(name|command|cmd)$/.test(key.text) && value.type === "string") reg ??= value;
      else if (/^(handler|run|action|fn)$/.test(key.text) && value.type === "identifier") handler = true;
    }
    const name = reg && handler ? stringValue(reg) : null;
    if (!reg || !name) continue;
    out.push(
      candidate("cli.registry@1", "cli", input, lineOf(reg), { command: name, flags: [], framework: "registry", table: `${obj.parent?.startIndex ?? 0}` }),
    );
  }
  return out;
}

const TEST_MODS = new Set(["only", "skip", "each", "concurrent", "todo", "failing", "serial"]);

export function jsTests(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.class !== "test" && input.file.scope !== "test") return [];
  // `describe(`/`it(`/`test(`… with a literal name, found in the text and confirmed on the tree (cheaper than a query
  // that matches every call with a string argument)
  const calls: { start: number; end: number; describe: boolean; name: string; line: number }[] = [];
  const re = /\b(describe|it|test|bench|suite|context|Deno)(?:\.(only|skip|each|concurrent|todo|failing|serial|test))?\s*\(\s*(["'`])/g;
  for (const m of input.text.matchAll(re)) {
    const fn = m[1] as string;
    const mod = m[2];
    if ((fn === "Deno") !== (mod === "test") || (mod !== undefined && fn !== "Deno" && !TEST_MODS.has(mod))) continue;
    const quote = (m.index ?? 0) + (m[0] as string).length - 1;
    const tok = tree.rootNode.descendantForIndex(quote);
    const str = tok?.type === "string" || tok?.type === "template_string" ? tok : tok?.parent;
    const call = str?.parent?.parent;
    if (!str || (str.type !== "string" && str.type !== "template_string") || str.parent?.type !== "arguments" || call?.type !== "call_expression") continue;
    if (str.parent.namedChildren[0]?.id !== str.id) continue;
    const name = patternOf(str)?.pattern;
    if (name === undefined) continue;
    calls.push({ start: call.startIndex, end: call.endIndex, describe: /^(describe|suite|context)$/.test(fn), name, line: lineOf(call) });
  }
  const describes = calls.filter((c) => c.describe);
  const out: FactCandidate[] = [];
  for (const c of calls) {
    if (c.describe) continue;
    const parents = describes.filter((d) => d.start < c.start && c.end <= d.end).sort((a, b) => a.start - b.start);
    out.push(candidate("test.js@1", "test", input, c.line, { name: [...parents.map((d) => d.name), c.name].join(" › ") }));
  }
  return out;
}
