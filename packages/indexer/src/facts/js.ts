/** TS / JS fact extractors (Worker side): route.express, route.hono, env.js, cli.commander, cli.registry, test.js. */
import type { FactCandidate, FactEvidence, FactExtractInput } from "../contract.ts";
import { candidate, ENV_NAME_RE } from "./candidate.ts";
import { JS_FACTS } from "./queries.ts";
import { capsOf, lineOf, matchesOf, type Node, patternOf, stringValue, type Tree } from "./tsq.ts";

const jsMatches = (tree: Tree) => matchesOf(tree, "js", JS_FACTS).map(capsOf);

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "all"]);

/** `import x from "<pkg>"` / `require("<pkg>")` evidence for a set of package names. */
function importEvidence(input: FactExtractInput, pkgs: readonly string[]): FactEvidence[] {
  const out: FactEvidence[] = [];
  for (const p of pkgs) if (input.imports.some((i) => i.spec === p || i.spec.startsWith(`${p}/`))) out.push(`import:${p}`);
  return out;
}

function bindings(tree: Tree): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of jsMatches(tree)) {
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
  if (input.file.scope === "test") return [];
  const binds = bindings(tree);
  const ev = importEvidence(input, ["express", "hono", "@hono/zod-openapi", "fastify", "koa-router", "@koa/router"]);
  const out: FactCandidate[] = [];
  for (const c of jsMatches(tree)) {
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
    const handler =
      handlerNode?.type === "identifier"
        ? handlerNode.text
        : handlerNode?.type === "member_expression"
          ? handlerNode.childForFieldName("property")?.text
          : undefined;
    out.push(
      candidate(
        "route.js@1",
        "route",
        input,
        lineOf(call),
        { method, pattern: p.pattern, ...(p.dynamic ? { dynamic: true } : {}), ...(handler ? { handler } : {}) },
        evidence,
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

export function jsEnv(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const out: FactCandidate[] = [];
  const push = (name: string, line: number, hasDefault: boolean) => {
    if (ENV_NAME_RE.test(name)) out.push(candidate("env.js@1", "env", input, line, { name, hasDefault }));
  };
  for (const c of jsMatches(tree)) {
    const n = c["env.name"];
    if (n) {
      const name = n.type === "string" ? stringValue(n) : n.text;
      if (name === null) continue;
      const expr = n.parent?.type === "arguments" ? (n.parent.parent ?? n) : (n.parent ?? n);
      push(name, lineOf(n), hasDefaultAt(expr));
      continue;
    }
    const pat = c["env.destructure"];
    if (!pat) continue;
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
  const all = jsMatches(tree);
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

export function jsRegistry(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const out: FactCandidate[] = [];
  for (const c of jsMatches(tree)) {
    const reg = c["cli.reg"];
    const entry = c["cli.table"];
    if (!reg || !entry) continue;
    const name = stringValue(reg);
    if (!name) continue;
    out.push(
      candidate("cli.registry@1", "cli", input, lineOf(reg), { command: name, flags: [], framework: "registry", table: `${entry.parent?.startIndex ?? 0}` }),
    );
  }
  return out;
}

const TEST_FNS = new Set(["describe", "it", "test", "bench", "suite", "context"]);
const TEST_MODS = new Set(["only", "skip", "each", "concurrent", "todo", "failing", "serial"]);

function testLabel(c: Record<string, Node>): boolean {
  const fn = c["test.fn"]?.text;
  if (fn !== undefined) return TEST_FNS.has(fn);
  const obj = c["test.obj"]?.text;
  const prop = c["test.prop"]?.text ?? "";
  return (obj !== undefined && TEST_FNS.has(obj) && TEST_MODS.has(prop)) || (obj === "Deno" && prop === "test");
}

export function jsTests(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.class !== "test" && input.file.scope !== "test") return [];
  const out: FactCandidate[] = [];
  const describeName = (call: Node): string | null => {
    const f = call.childForFieldName("function");
    const head = f?.type === "member_expression" ? f.childForFieldName("object")?.text : f?.text;
    if (head !== "describe" && head !== "suite" && head !== "context") return null;
    const a = call.childForFieldName("arguments")?.namedChildren[0];
    return a ? (patternOf(a)?.pattern ?? null) : null;
  };
  for (const c of jsMatches(tree)) {
    const call = c["test.call"];
    const nameNode = c["test.name"];
    if (!call || !nameNode || !testLabel(c)) continue;
    if (describeName(call) !== null) continue;
    const own = patternOf(nameNode)?.pattern;
    if (own === undefined) continue;
    const parts = [own];
    for (let p = call.parent; p; p = p.parent)
      if (p.type === "call_expression") {
        const d = describeName(p);
        if (d !== null) parts.unshift(d);
      }
    out.push(candidate("test.js@1", "test", input, lineOf(call), { name: parts.join(" › ") }));
  }
  return out;
}
