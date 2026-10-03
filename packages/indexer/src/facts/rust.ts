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
