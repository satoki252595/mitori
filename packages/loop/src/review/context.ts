// `Thread.context` (CR safe-6, cr-requests/ux.md #2 / #6): the code a human chose for a thread besides its anchor.
// Before, a picked Fix candidate or an `@` mention travelled only as the push job's `context.add`; on ⤴ (pull) and
// ⧉ (copy) the agent got `WRITE -`. Validated here once, merged with a request's own context when a job is planned.
import { type ContextAdjust, type LineNo, MitoriError, parseRepoPath, type RepoPath, THREAD_CONTEXT_LIMITS, type ThreadContext } from "@mitori/core";

const bad = (field: string, message: string) => new MitoriError("E_INVALID_INPUT", message, { params: { field } });

/** A validated, deduplicated context; null when it carries nothing. Throws `E_INVALID_INPUT` on a malformed one. */
export function threadContext(input: ContextAdjust | null | undefined): ThreadContext | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw bad("context", "context must be an object");
  const add: { path: RepoPath; start: LineNo; end: LineNo }[] = [];
  const seen = new Set<string>();
  const adds = input.add ?? [];
  if (!Array.isArray(adds) || adds.length > THREAD_CONTEXT_LIMITS.add)
    throw bad("context.add", `context.add takes at most ${THREAD_CONTEXT_LIMITS.add} ranges`);
  for (const a of adds) {
    const p = parseRepoPath(String(a?.path ?? ""));
    if (!p.ok) throw bad("context.add", `invalid path in context.add: ${String(a?.path)}`);
    const whole = a.start === 0 && a.end === 0;
    if (!Number.isInteger(a.start) || !Number.isInteger(a.end) || (!whole && (a.start < 1 || a.end < a.start)))
      throw bad("context.add", `invalid range in context.add: ${p.value}:${a.start}-${a.end}`);
    const key = `${p.value}:${a.start}-${a.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add.push({ path: p.value, start: a.start, end: a.end });
  }
  const removes = input.remove ?? [];
  if (!Array.isArray(removes) || removes.length > THREAD_CONTEXT_LIMITS.remove)
    throw bad("context.remove", `context.remove takes at most ${THREAD_CONTEXT_LIMITS.remove} keys`);
  const remove = [...new Set(removes.map(String))];
  if (remove.some((k) => k === "" || k.length > THREAD_CONTEXT_LIMITS.keyMaxChars)) throw bad("context.remove", "invalid key in context.remove");
  for (const k of remove)
    if (k.startsWith("write:") && !parseRepoPath(k.slice("write:".length)).ok) throw bad("context.remove", `invalid path in context.remove: ${k}`);
  if (add.length === 0 && remove.length === 0) return null;
  return { ...(add.length > 0 ? { add } : {}), ...(remove.length > 0 ? { remove: remove.sort() } : {}) };
}

/** Union of contexts (a request's own chips and the threads' stored ones); undefined when none carries anything. */
export function mergeContexts(...cs: readonly (ContextAdjust | null | undefined)[]): ContextAdjust | undefined {
  const add: { path: RepoPath; start: LineNo; end: LineNo }[] = [];
  const seen = new Set<string>();
  const remove = new Set<string>();
  for (const c of cs) {
    for (const a of c?.add ?? []) {
      const key = `${a.path}:${a.start}-${a.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add.push(a);
    }
    for (const k of c?.remove ?? []) remove.add(k);
  }
  if (add.length === 0 && remove.size === 0) return undefined;
  return { ...(add.length > 0 ? { add } : {}), ...(remove.size > 0 ? { remove: [...remove].sort() } : {}) };
}

/** `write:<path>` removals: cited files the human left out of WRITE (they stay read context). */
export function writeRemovals(c: Pick<ContextAdjust, "remove"> | null | undefined): Set<RepoPath> {
  return new Set((c?.remove ?? []).filter((k) => k.startsWith("write:")).map((k) => k.slice("write:".length) as RepoPath));
}
