/**
 * web-tree-sitter helpers for the fact extractors (they run inside the parse Worker while the tree is alive, spec
 * §5.1). Each fact query runs at most once per tree; its matches are kept as capture records shared by all detectors.
 */
import type { LineNo } from "@mitori/core";
import { type Language, type Node, Query, type QueryMatch, type Tree } from "web-tree-sitter";
import type { FactQuery } from "./queries.ts";

export type { Node, Tree };

/** One match as capture name → first node. */
export type Caps = Record<string, Node>;

const compiled = new WeakMap<Language, Map<string, Query>>();
const perTree = new WeakMap<Tree, Map<string, Caps[]>>();

/** Runtime guard for the opaque `FactExtractInput.tree`. */
export function asTree(tree: unknown): Tree | null {
  return typeof tree === "object" && tree !== null && "rootNode" in tree && "language" in tree ? (tree as Tree) : null;
}

/** Matches of `query` over `tree` as capture records, memoized per tree (queries compiled once per language). */
export function capsFor(tree: Tree, query: FactQuery): Caps[] {
  let byId = perTree.get(tree);
  if (!byId) {
    byId = new Map();
    perTree.set(tree, byId);
  }
  const hit = byId.get(query.id);
  if (hit) return hit;
  let qs = compiled.get(tree.language);
  if (!qs) {
    qs = new Map();
    compiled.set(tree.language, qs);
  }
  let q = qs.get(query.id);
  if (!q) {
    q = new Query(tree.language, query.src);
    qs.set(query.id, q);
  }
  const caps = q.matches(tree.rootNode).map(capsOf);
  byId.set(query.id, caps);
  return caps;
}

/** First node per capture name of a match. */
function capsOf(m: QueryMatch): Caps {
  const out: Caps = {};
  for (const c of m.captures) if (!(c.name in out)) out[c.name] = c.node;
  return out;
}

export const lineOf = (n: Node): LineNo => n.startPosition.row + 1;

/** Text of a string literal node without quotes / prefixes (`"x"`, `'x'`, `` `x` ``, `r"x"`, `f"x"`). */
export function unquote(text: string): string {
  const m = /^[rRbBuUfF]{0,2}("""|'''|"|'|`)([\s\S]*)\1$/.exec(text);
  return m ? (m[2] as string) : text;
}

/** True when a Python / JS string node contains interpolation (f-string, template substitution). */
export function isInterpolated(n: Node): boolean {
  return n.descendantsOfType(["interpolation", "template_substitution"]).length > 0;
}

/** Literal text of a string node, or `null` when it is not a plain literal. */
export function stringValue(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (!/string|literal/.test(n.type)) return null;
  if (isInterpolated(n)) return null;
  return unquote(n.text);
}

/** Template / concatenation → `literal{…}` pattern with a dynamic flag (spec §5.2 route concat rule). */
export function patternOf(n: Node | null | undefined): { pattern: string; dynamic: boolean } | null {
  if (!n) return null;
  if (n.type === "template_string") {
    let out = "";
    let dyn = false;
    for (const c of n.namedChildren) {
      if (!c) continue;
      if (c.type === "template_substitution") {
        out += "{…}";
        dyn = true;
      } else if (c.type === "string_fragment") out += c.text;
    }
    if (n.namedChildren.length === 0) out = unquote(n.text);
    return { pattern: out, dynamic: dyn };
  }
  if (n.type === "binary_expression") {
    const left = n.childForFieldName("left");
    const right = n.childForFieldName("right");
    const l = patternOf(left);
    if (!l) return null;
    const r = right ? (stringValue(right) ?? "{…}") : "{…}";
    return { pattern: l.pattern + r, dynamic: true };
  }
  const v = stringValue(n);
  return v === null ? null : { pattern: v, dynamic: false };
}

/** Nearest ancestor of one of `types`. */
export function ancestor(n: Node, types: readonly string[], maxUp = 64): Node | null {
  let cur = n.parent;
  for (let i = 0; cur && i < maxUp; i++, cur = cur.parent) if (types.includes(cur.type)) return cur;
  return null;
}

/** The name a function value is referenced by: `h`, `s.handleX` (Go), `ctrl.list` (JS), `views.index` (Python). */
function valueName(n: Node): string | null {
  switch (n.type) {
    case "identifier":
      return n.text;
    case "selector_expression":
      return n.childForFieldName("field")?.text ?? null;
    case "member_expression":
      return n.childForFieldName("property")?.text ?? null;
    case "attribute":
      return n.childForFieldName("attribute")?.text ?? null;
    default:
      return null;
  }
}

const WRAPPERS = new Set(["parenthesized_expression", "unary_expression", "await_expression", "as_expression", "non_null_expression", "satisfies_expression"]);

/**
 * Names a route's handler expression may resolve to, most specific first (gen #4c): the function value itself
 * (`s.handleX`, `listBooks`, `ctrl.list`); for a wrapped value — middleware (`s.withReady(s.handleX)`), adapters
 * (`http.HandlerFunc(h)`), bound methods (`h.bind(this)`), class views (`View.as_view("v")`) — the wrapped arguments
 * from the last one in, innermost first; the called factory last (`s.serveIndexHTML()`, `s.serveEmbeddedJS("x.js")`,
 * `makeHandler(cfg)`), so a factory names the route when nothing it wraps resolves. Literals and inline functions
 * name nothing. Duplicates are dropped (first kept), ≤ 8 names.
 */
export function handlerNames(n: Node | null | undefined): string[] {
  const out: string[] = [];
  const walk = (x: Node | null | undefined, depth: number): void => {
    if (!x || depth > 4 || out.length >= 8) return;
    const direct = valueName(x);
    if (direct !== null) {
      out.push(direct);
      return;
    }
    if (WRAPPERS.has(x.type)) {
      walk(
        x.namedChildren.find((c) => c !== null && c.type !== "comment"),
        depth + 1,
      );
      return;
    }
    if (x.type !== "call_expression" && x.type !== "call") return;
    const fn = x.childForFieldName("function");
    const args = (x.childForFieldName("arguments")?.namedChildren ?? []).filter((c): c is Node => c !== null && c.type !== "comment");
    const callee = fn ? valueName(fn) : null;
    // `View.as_view("v")` / `h.bind(this)`: the receiver is the function value
    if ((callee === "as_view" || callee === "bind") && fn) {
      walk(fn.childForFieldName("object") ?? fn.childForFieldName("operand"), depth + 1);
      return;
    }
    for (const a of [...args].reverse()) walk(a.type === "keyword_argument" ? a.childForFieldName("value") : a, depth + 1);
    if (callee !== null) out.push(callee);
  };
  walk(n, 0);
  return [...new Set(out)];
}
