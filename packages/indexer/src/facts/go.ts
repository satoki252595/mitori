/** Go fact extractors (Worker side): entry.go, route.nethttp, env.go, cli.cobra, cli.registry, test.go. */
import type { FactCandidate, FactEvidence, FactExtractInput } from "../contract.ts";
import { dirOf } from "../resolve/files.ts";
import { candidate } from "./candidate.ts";
import { GO_FACTS } from "./queries.ts";
import { capsOf, lineOf, matchesOf, type Node, patternOf, stringValue, type Tree, unquote } from "./tsq.ts";

const goMatches = (tree: Tree) => matchesOf(tree, "go", GO_FACTS).map(capsOf);
const imports = (input: FactExtractInput, spec: string) => input.imports.some((i) => i.spec === spec);
const isMain = (tree: Tree) => goMatches(tree).some((c) => c.pkg?.text === "main");

export function goEntry(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !isMain(tree)) return [];
  return goMatches(tree)
    .filter((c) => c["entry.main"])
    .map((c) => candidate("entry.go@1", "entry", input, lineOf(c["entry.main"] as Node), { entry: "main", label: dirOf(input.file.path) || "." }));
}

export function goRoutes(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const all = goMatches(tree);
  const consts = new Map<string, string>();
  const binds = new Map<string, string>();
  for (const c of all) {
    if (c["const.name"] && c["const.value"]) consts.set(c["const.name"].text, unquote(c["const.value"].text));
    if (c["bind.name"] && c["bind.fn"]) binds.set(c["bind.name"].text, c["bind.fn"].text);
  }
  const ev: FactEvidence[] = imports(input, "net/http") ? ["import:net/http"] : [];
  if (imports(input, "github.com/gorilla/mux")) ev.push("import:github.com/gorilla/mux");
  const out: FactCandidate[] = [];
  for (const c of all) {
    const route = c.route;
    const pathNode = c["route.path"];
    if (!route || !pathNode) continue;
    let p =
      pathNode.type === "identifier"
        ? consts.has(pathNode.text)
          ? { pattern: consts.get(pathNode.text) as string, dynamic: false }
          : null
        : patternOf(pathNode);
    if (pathNode.type === "raw_string_literal") p = { pattern: unquote(pathNode.text), dynamic: false };
    if (!p) continue;
    let method = "ANY";
    let pattern = p.pattern;
    const m = /^([A-Z]+)\s+(\/.*)$/.exec(pattern);
    if (m) {
      method = m[1] as string;
      pattern = m[2] as string;
    }
    if (!/^[/*]/.test(pattern)) continue;
    const recv = c["route.recv"]?.text ?? "";
    const evidence: FactEvidence[] = [...ev, `recv:${recv}`];
    const bound = binds.get(recv);
    if (bound !== undefined) evidence.push(`bind:${bound}`);
    const handler = /\.?([A-Za-z_]\w*)\)*$/.exec(c["route.handler"]?.text ?? "")?.[1];
    out.push(
      candidate(
        "route.nethttp@1",
        "route",
        input,
        lineOf(route),
        {
          method,
          pattern,
          framework: "net/http",
          ...(p.dynamic ? { dynamic: true } : {}),
          ...(handler !== undefined && !c["route.handler"]?.text.startsWith("func") ? { handler } : {}),
        },
        evidence,
      ),
    );
  }
  return out;
}

export function goEnv(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const out: FactCandidate[] = [];
  for (const c of goMatches(tree)) {
    const nameNode = c["env.name"];
    const call = c["env.call"];
    if (!nameNode || !call) continue;
    const name = stringValue(nameNode);
    if (name === null) continue;
    const fn = call.childForFieldName("function")?.childForFieldName("field")?.text ?? "";
    // `cmp.Or(os.Getenv("X"), "8080")`: a literal next to the read in the same call is the default
    const parent = call.parent;
    const hasDefault =
      fn === "Getenv" &&
      parent?.type === "argument_list" &&
      parent.namedChildren.some((s) => s !== null && s.id !== call.id && /literal$/.test(s.type) && s.type !== "nil");
    out.push(candidate("env.go@1", "env", input, lineOf(nameNode), { name, hasDefault }));
  }
  return out;
}

/** Package-main command name (`cmd/crit/x.go` → `crit`). */
function progOf(input: FactExtractInput, tree: Tree): string {
  if (!isMain(tree)) return "";
  const dir = dirOf(input.file.path);
  return dir === "" ? "" : (dir.split("/").pop() as string);
}

export function goRegistry(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const prog = progOf(input, tree);
  const out: FactCandidate[] = [];
  for (const c of goMatches(tree)) {
    const reg = c["cli.reg"];
    const entry = c["cli.table"];
    if (!reg || !entry) continue;
    const name = stringValue(reg);
    if (name === null || name === "") continue;
    const table = entry.parent?.parent ?? entry.parent;
    out.push(
      candidate("cli.registry@1", "cli", input, lineOf(reg), {
        command: prog === "" ? name : `${prog} ${name}`,
        flags: [],
        framework: "registry",
        table: `${table?.startIndex ?? 0}`,
      }),
    );
  }
  return out;
}

/** `&cobra.Command{Use: "x …"}` + `<v>.Flags().<T>Var[P](&v, "long", …)` + `parent.AddCommand(child…)`. */
export function goCobra(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test" || !imports(input, "github.com/spf13/cobra")) return [];
  const cmds = new Map<string, { use: string; line: number; flags: string[] }>();
  const parentOf = new Map<string, string>();
  const anon: { use: string; line: number }[] = [];
  for (const lit of tree.rootNode.descendantsOfType("composite_literal")) {
    if (!lit) continue;
    const type = lit.childForFieldName("type");
    if (type?.text !== "cobra.Command") continue;
    let use: string | null = null;
    for (const kv of lit.descendantsOfType("keyed_element")) {
      if (!kv || kv.parent?.id !== lit.childForFieldName("body")?.id) continue;
      const [k, v] = kv.namedChildren;
      if (k?.text === "Use") use = stringValue(v?.namedChildren[0] ?? v ?? null);
    }
    if (use === null) continue;
    const word = use.trim().split(/\s+/)[0] ?? "";
    const holder = lit.parent?.type === "unary_expression" ? lit.parent.parent : lit.parent;
    const decl = holder?.type === "expression_list" ? holder.parent : holder;
    let varName: string | null = null;
    if (decl && (decl.type === "short_var_declaration" || decl.type === "assignment_statement"))
      varName = decl.childForFieldName("left")?.namedChildren[0]?.text ?? null;
    else if (decl?.type === "var_spec") varName = decl.childForFieldName("name")?.text ?? null;
    if (varName === null) anon.push({ use: word, line: lineOf(lit) });
    else cmds.set(varName, { use: word, line: lineOf(lit), flags: [] });
  }
  for (const call of tree.rootNode.descendantsOfType("call_expression")) {
    if (!call) continue;
    const fn = call.childForFieldName("function");
    if (fn?.type !== "selector_expression") continue;
    const field = fn.childForFieldName("field")?.text ?? "";
    const operand = fn.childForFieldName("operand");
    const args = call.childForFieldName("arguments")?.namedChildren.filter((x): x is Node => x !== null) ?? [];
    if (field === "AddCommand" && operand?.type === "identifier") {
      for (const a of args) if (a.type === "identifier") parentOf.set(a.text, operand.text);
      continue;
    }
    // <cmd>.Flags().StringVar(&v, "name", …) / .String("name", …) / …P variants
    if (operand?.type !== "call_expression") continue;
    const inner = operand.childForFieldName("function");
    const innerField = inner?.childForFieldName("field")?.text;
    if (innerField !== "Flags" && innerField !== "PersistentFlags") continue;
    const owner = inner?.childForFieldName("operand")?.text ?? "";
    const isVar = /Var(P)?$/.test(field);
    const longNode = args[isVar ? 1 : 0];
    const long = stringValue(longNode);
    const shortNode = /P$/.test(field) ? args[isVar ? 2 : 1] : undefined;
    const short = stringValue(shortNode);
    const cmd = cmds.get(owner);
    if (cmd && long) cmd.flags.push(`--${long}`);
    if (cmd && short) cmd.flags.push(`-${short}`);
  }
  const pathOf = (v: string, seen = new Set<string>()): string[] => {
    const c = cmds.get(v);
    if (!c || seen.has(v)) return [];
    seen.add(v);
    const p = parentOf.get(v);
    return [...(p === undefined ? [] : pathOf(p, seen)), c.use];
  };
  const hasChildren = new Set(parentOf.values());
  const out: FactCandidate[] = [];
  for (const [v, c] of cmds) {
    if (hasChildren.has(v) && c.flags.length === 0) continue;
    out.push(
      candidate("cli.cobra@1", "cli", input, c.line, { command: pathOf(v).join(" "), flags: c.flags, framework: "cobra" }, ["import:github.com/spf13/cobra"]),
    );
  }
  for (const a of anon)
    out.push(candidate("cli.cobra@1", "cli", input, a.line, { command: a.use, flags: [], framework: "cobra" }, ["import:github.com/spf13/cobra"]));
  return out;
}

export function goTests(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (!input.file.path.endsWith("_test.go")) return [];
  const out: FactCandidate[] = [];
  for (const c of goMatches(tree)) {
    const n = c["test.name"];
    if (!n) continue;
    out.push(candidate("test.go@1", "test", input, lineOf(n), { name: n.text }));
    const fn = n.parent;
    for (const call of fn?.descendantsOfType("call_expression") ?? []) {
      const f = call?.childForFieldName("function");
      if (!call || f?.type !== "selector_expression" || f.childForFieldName("field")?.text !== "Run") continue;
      const sub = stringValue(call.childForFieldName("arguments")?.namedChildren[0]);
      if (sub !== null) out.push(candidate("test.go@1", "test", input, lineOf(call), { name: `${n.text}/${sub.replace(/\s/g, "_")}` }));
    }
  }
  return out;
}
