/**
 * web-tree-sitter helpers for the fact extractors (they run inside the parse Worker while the tree is alive, spec
 * §5.1). The query of a grammar family runs once per tree and is shared by every detector of that file.
 */
import type { LineNo } from "@mitori/core";
import { type Language, type Node, Query, type QueryMatch, type Tree } from "web-tree-sitter";

export type { Node, Tree };

const compiled = new WeakMap<Language, Map<string, Query>>();
const perTree = new WeakMap<Tree, Map<string, QueryMatch[]>>();

/** Runtime guard for the opaque `FactExtractInput.tree`. */
export function asTree(tree: unknown): Tree | null {
  return typeof tree === "object" && tree !== null && "rootNode" in tree && "language" in tree ? (tree as Tree) : null;
}

/** Matches of query `id` (source `src`) over `tree`, memoized per tree. */
export function matchesOf(tree: Tree, id: string, src: string): QueryMatch[] {
  let byId = perTree.get(tree);
  if (!byId) {
    byId = new Map();
    perTree.set(tree, byId);
  }
  const hit = byId.get(id);
  if (hit) return hit;
  let qs = compiled.get(tree.language);
  if (!qs) {
    qs = new Map();
    compiled.set(tree.language, qs);
  }
  let q = qs.get(id);
  if (!q) {
    q = new Query(tree.language, src);
    qs.set(id, q);
  }
  const ms = q.matches(tree.rootNode);
  byId.set(id, ms);
  return ms;
}

/** First node per capture name of a match. */
export function capsOf(m: QueryMatch): Record<string, Node> {
  const out: Record<string, Node> = {};
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
