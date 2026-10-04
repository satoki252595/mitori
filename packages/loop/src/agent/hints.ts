// cr-requests/agent.md #6, spec §3.5: when a patch turn answers `needs_more_context`, the R2 agent job starts with what
// it asked for — resolved deterministically into read-only REL items of the agent bundle ("読み取り用の REL に足す。
// write scope は広げない"). Before, the agent started without them and spent one Read call per file.
import type { LineNo, RepoPath, SymbolEntry } from "@mitori/core";
import { definitionOf } from "../bundle/named.ts";
import { CONTRACT_LIMITS } from "../contract.ts";

/** A read-only range for the bundle's `hints` (≤ 30 lines each are shown, `bundle/build.ts`). */
export interface ReadHint {
  path: RepoPath;
  start: LineNo;
  end: LineNo;
}

/** Lines shown for a hint that names a whole file (the bundle caps a hint at 30 lines). */
export const READ_HINT_MAX_LINES = 30;

/** `MitoriError.params` key the patch pipeline stores the engine's `needs_more_context` items under (newline-joined). */
export const NEEDS_PARAM = "needs";

/**
 * Resolve the engine's `needs_more_context` strings into ranges of indexed files: `path`, `path:12`, `path:12-40`,
 * `path#L12-L40`, or a symbol name (`Fetch`, `config.Load`, `func Load`, "symbol Foo"). Unknown paths and names are
 * dropped; at most `CONTRACT_LIMITS.needsMoreContextMax` hints, first occurrence wins.
 */
export function resolveReadHints(
  ix: { file(path: RepoPath): { lines: number } | null; findSymbols(q: string, limit: number): SymbolEntry[] },
  needs: readonly string[],
): ReadHint[] {
  const out: ReadHint[] = [];
  const seen = new Set<string>();
  const push = (h: ReadHint) => {
    const key = `${h.path}:${h.start}`;
    if (seen.has(key) || out.length >= CONTRACT_LIMITS.needsMoreContextMax) return;
    seen.add(key);
    out.push(h);
  };
  for (const raw of needs.slice(0, CONTRACT_LIMITS.needsMoreContextMax)) {
    const item = raw.trim().slice(0, CONTRACT_LIMITS.needsMoreContextItemMaxChars);
    let matched = false;
    for (const m of item.matchAll(/([A-Za-z0-9_@.-][A-Za-z0-9_@.\-/]*\.[A-Za-z0-9]+)(?:(?::|#L)(\d+)(?:-L?(\d+))?)?/g)) {
      const path = (m[1] as string).replace(/^\.\//, "") as RepoPath;
      const f = ix.file(path);
      if (!f || f.lines < 1) continue;
      matched = true;
      const a = m[2] ? Math.min(Math.max(1, Number(m[2])), f.lines) : 1;
      const b = m[3] ? Math.min(Math.max(a, Number(m[3])), f.lines) : m[2] ? a : Math.min(f.lines, READ_HINT_MAX_LINES);
      push({ path, start: a as LineNo, end: b as LineNo });
    }
    if (matched) continue;
    // a symbol: the last identifier-ish token of the item ("func Load", "symbol Foo", "`config.Load()`")
    const names = [...item.replace(/[`()]/g, " ").matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)].map((x) => x[0]);
    for (const name of names.reverse()) {
      if (/^(func|function|def|class|type|symbol|method|struct|interface|the|of|and|in)$/i.test(name)) continue;
      const def = definitionOf(ix.findSymbols.bind(ix), name);
      if (def) {
        push({ path: def.path, start: def.start, end: def.end });
        break;
      }
    }
  }
  return out;
}

/** The `needs_more_context` items a failed patch job carried (empty when none). */
export function needsOf(params: Readonly<Record<string, unknown>> | undefined): string[] {
  const v = params?.[NEEDS_PARAM];
  return typeof v === "string" && v !== "" ? v.split("\n") : [];
}
