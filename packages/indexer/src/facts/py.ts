/** Python fact extractors (Worker side): route.fastapi, route.flask, env.python, cli.click, entry.python, test.python. */
import type { FactCandidate, FactEvidence, FactExtractInput } from "../contract.ts";
import { baseOf } from "../resolve/files.ts";
import { candidate, ENV_NAME_RE } from "./candidate.ts";
import { PY } from "./queries.ts";
import { capsFor, handlerNames, lineOf, type Node, stringValue, type Tree } from "./tsq.ts";

const ROUTE_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
  "route",
  "api_route",
  "websocket",
  "add_url_rule",
  "add_api_route",
]);

const importsAny = (input: FactExtractInput, pkg: string) => input.imports.some((i) => i.spec === pkg || i.spec.startsWith(`${pkg}.`));

/** Keyword argument value node (`methods=[…]`). */
function kwarg(args: Node | undefined, name: string): Node | null {
  for (const a of args?.namedChildren ?? [])
    if (a?.type === "keyword_argument" && a.childForFieldName("name")?.text === name) return a.childForFieldName("value");
  return null;
}

function stringList(n: Node | null): string[] | null {
  if (!n || (n.type !== "list" && n.type !== "tuple" && n.type !== "set")) return null;
  const out: string[] = [];
  for (const c of n.namedChildren) {
    const v = stringValue(c);
    if (v !== null) out.push(v);
  }
  return out;
}

const routeCache = new WeakMap<Tree, FactCandidate[]>();

/**
 * The view argument of a call-registered route: `view_func=` (Flask) / `endpoint=` (FastAPI, a function there), else
 * the positional one (`add_url_rule(rule, endpoint, view_func)` → 3rd, `add_api_route(path, endpoint)` → 2nd).
 */
function callHandlerArg(args: Node | undefined, method: string): Node | null {
  if (method !== "add_url_rule" && method !== "add_api_route") return null;
  const flask = method === "add_url_rule";
  const kw = kwarg(args, flask ? "view_func" : "endpoint");
  if (kw) return kw;
  const positional = (args?.namedChildren ?? []).filter((a): a is Node => a !== null && a.type !== "keyword_argument" && a.type !== "comment");
  return positional[flask ? 2 : 1] ?? null;
}

/** Framework of a Python route candidate from the receiver binding, then the imports (null = ambiguous). */
export function pyRouteFramework(evidence: readonly string[]): "fastapi" | "flask" | null {
  const bind = evidence.find((e) => e.startsWith("bind:"))?.slice(5) ?? "";
  if (/(^|\.)(FastAPI|APIRouter)$/.test(bind)) return "fastapi";
  if (/(^|\.)(Flask|Blueprint)$/.test(bind)) return "flask";
  const fa = evidence.includes("import:fastapi");
  const fl = evidence.includes("import:flask");
  return fa && !fl ? "fastapi" : fl && !fa ? "flask" : null;
}

export function pyRoutes(input: FactExtractInput, tree: Tree, fw: "fastapi" | "flask"): FactCandidate[] {
  const all = routeCache.get(tree) ?? pyRouteCandidates(input, tree);
  routeCache.set(tree, all);
  return all.filter((c) => pyRouteFramework(c.evidence) === fw).map((c) => ({ ...c, detector: `route.${fw}@1`, data: { ...c.data, framework: fw } }));
}

function pyRouteCandidates(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (
    input.file.scope === "test" ||
    !/\.(get|post|put|patch|delete|options|head|trace|route|api_route|websocket|add_url_rule|add_api_route)\s*\(/.test(input.text)
  )
    return [];
  const binds = new Map<string, string>();
  const all = capsFor(tree, PY.route);
  for (const c of all) if (c["bind.name"] && c["bind.fn"] && !binds.has(c["bind.name"].text)) binds.set(c["bind.name"].text, c["bind.fn"].text);
  const ev: FactEvidence[] = [];
  if (importsAny(input, "fastapi")) ev.push("import:fastapi");
  if (importsAny(input, "flask")) ev.push("import:flask");
  const out: FactCandidate[] = [];
  for (const c of all) {
    const node = c.route ?? c["route.call"];
    const methodName = c["route.method"]?.text ?? "";
    if (!node || !ROUTE_METHODS.has(methodName)) continue;
    const pattern = stringValue(c["route.path"]);
    if (pattern === null || !/^[/*]/.test(pattern)) continue;
    const args = c["route.args"];
    const listed = stringList(kwarg(args, "methods"));
    let methods: string[];
    if (listed && listed.length > 0) methods = listed.map((m) => m.toUpperCase());
    else if (methodName === "route" || methodName === "add_url_rule") methods = ["GET"];
    else if (methodName === "api_route" || methodName === "add_api_route") methods = ["ANY"];
    else if (methodName === "websocket") methods = ["WEBSOCKET"];
    else methods = [methodName.toUpperCase()];
    const recv = c["route.recv"]?.text ?? "";
    const evidence: FactEvidence[] = [...ev, `recv:${recv}`];
    const bound = binds.get(recv);
    if (bound !== undefined) evidence.push(`bind:${bound}`);
    // decorated: the function itself; `add_url_rule(rule, endpoint, view_func)` / `add_api_route(path, endpoint)`:
    // the function value argument (`views.index`, `Items.as_view("items")`, `router_fn`) — gen #4c
    const handlers = c["route.handler"] ? [c["route.handler"].text] : handlerNames(callHandlerArg(args, methodName));
    const line = lineOf(c["route.path"] ?? node);
    for (const method of methods)
      out.push(
        candidate("route.py@1", "route", input, line, { method, pattern, ...(handlers.length > 0 ? { handler: handlers[0], handlers } : {}) }, evidence),
      );
  }
  return out;
}

export function pyEnv(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !/\bos\.(environ|getenv)\b/.test(input.text)) return [];
  const out: FactCandidate[] = [];
  for (const c of capsFor(tree, PY.env)) {
    const n = c["env.name"];
    if (!n) continue;
    const name = stringValue(n); // null for f-strings (spec §5.2 env.python@1)
    if (name === null || !ENV_NAME_RE.test(name)) continue;
    const args = c["env.args"];
    const hasDefault = args !== undefined && args.namedChildren.filter((x) => x !== null && x.type !== "comment").length >= 2;
    out.push(candidate("env.python@1", "env", input, lineOf(n), { name, hasDefault }));
  }
  return out;
}

/** click: `@click.command()/group()`, `@<g>.command("x")`, `@click.option("--x")`. Command paths are composed at link time. */
export function pyClick(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !importsAny(input, "click")) return [];
  const out: FactCandidate[] = [];
  for (const def of tree.rootNode.descendantsOfType("decorated_definition")) {
    if (!def) continue;
    const fn = def.childForFieldName("definition");
    if (fn?.type !== "function_definition") continue;
    const fnName = fn.childForFieldName("name")?.text ?? "";
    let kind: "command" | "group" | null = null;
    let parent = "";
    let explicit: string | null = null;
    const flags: string[] = [];
    for (const d of def.namedChildren) {
      if (d?.type !== "decorator") continue;
      const call = d.namedChildren.find((x) => x?.type === "call");
      const f = call?.childForFieldName("function") ?? d.namedChildren.find((x) => x?.type === "attribute");
      if (f?.type !== "attribute") continue;
      const obj = f.childForFieldName("object")?.text ?? "";
      const attr = f.childForFieldName("attribute")?.text ?? "";
      const args = call?.childForFieldName("arguments");
      if (attr === "command" || attr === "group") {
        kind = attr;
        parent = obj === "click" ? "" : obj;
        explicit = stringValue(args?.namedChildren[0]);
      } else if (obj === "click" && attr === "option") {
        for (const a of args?.namedChildren ?? []) {
          const v = stringValue(a);
          if (v?.startsWith("-")) flags.push(...v.split(/[\s/]+/).filter((s) => s.startsWith("-")));
        }
      }
    }
    if (kind === null) continue;
    out.push(
      candidate(
        "cli.click@1",
        "cli",
        input,
        lineOf(fn),
        { fn: fnName, name: explicit ?? fnName.replaceAll("_", "-"), parent, group: kind === "group", flags, framework: "click" },
        ["import:click"],
      ),
    );
  }
  return out;
}

export function pyEntry(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const out: FactCandidate[] = [];
  if (baseOf(input.file.path) === "__main__.py") out.push(candidate("entry.python@1", "entry", input, 1, { entry: "main", label: "__main__" }));
  else if (input.text.includes("__main__"))
    for (const c of capsFor(tree, PY.entry)) {
      const n = c["entry.ifmain"];
      if (n && /__main__/.test(n.childForFieldName("condition")?.text ?? ""))
        out.push(candidate("entry.python@1", "entry", input, lineOf(n), { entry: "main", label: input.file.path }));
    }
  return out;
}

export function pyTests(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.class !== "test" && input.file.scope !== "test") return [];
  const out: FactCandidate[] = [];
  for (const c of capsFor(tree, PY.tests)) {
    const n = c["test.name"];
    if (!n) continue;
    const cls = n.parent?.parent?.type === "block" ? n.parent.parent.parent : null;
    const clsName = cls?.type === "class_definition" ? cls.childForFieldName("name")?.text : undefined;
    // pytest classes (`class TestFoo`) qualify the name; unittest `TestCase` subclasses keep the plain method name
    const qualified = clsName?.startsWith("Test") === true;
    if (clsName !== undefined && !qualified && !/TestCase\b/.test(cls?.childForFieldName("superclasses")?.text ?? "")) continue;
    out.push(candidate("test.python@1", "test", input, lineOf(n), { name: qualified ? `${clsName}::${n.text}` : n.text }));
  }
  return out;
}
