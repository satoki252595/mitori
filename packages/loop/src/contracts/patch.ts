import {
  type BlockId,
  type BlockKind,
  type DocUpdate,
  type PatchEdit,
  type PatchOutput,
  parseRepoPath,
  type RepoPath,
  type Result,
  type ThreadId,
  type ThreadOutcome,
} from "@mitori/core";
import { CONTRACT_LIMITS, type ParsedAgent, type ParsedPatch } from "../contract.ts";
import { Checks, isObject, type Json, type ParseFailure, payload } from "./check.ts";
import { newTextLines, normLine } from "./text.ts";

/** What the bundle told the engine: which threads and doc blocks it may talk about, and where it may write. */
interface TaskCtx {
  taskThreads: ThreadId[];
  docBlocks: BlockId[];
  blockKinds: Record<BlockId, BlockKind>;
  primaryBlock: BlockId | null;
}

const STATUSES = ["done", "answer", "question", "skip"] as const;

/** Parse + fully validate `patch/1` (spec §5.1). Existence of the files and the deny globs are checked at application time. */
export function parsePatch(raw: { structured?: unknown; text?: string }, ctx: TaskCtx & { write: RepoPath[] }): Result<ParsedPatch, ParseFailure> {
  const body = payload(raw);
  if (!body.ok) return body;
  const checks = new Checks();
  const o = body.value;
  if (!isObject(o)) {
    checks.add("", "a patch/1 object", o);
    return { ok: false, error: checks.failure() };
  }

  const summary = summaryOf(o, checks);
  const needsMoreContext = stringList(
    o.needs_more_context,
    "/needs_more_context",
    CONTRACT_LIMITS.needsMoreContextMax,
    CONTRACT_LIMITS.needsMoreContextItemMaxChars,
    checks,
  );
  const edits = parseEdits(o.edits, ctx, checks);
  if (needsMoreContext.length > 0 && edits.length > 0) checks.add("/edits", "no edits while needs_more_context is non-empty", `${edits.length} edits`);
  if (needsMoreContext.length === 0 && edits.length === 0 && Array.isArray(o.edits))
    checks.add("/edits", "at least one edit (or a non-empty needs_more_context)", "no edits");
  const docUpdates = parseDocUpdates(o.doc_updates, ctx, checks);
  const threads = parseThreads(o.threads, ctx.taskThreads, checks);
  if (!checks.ok) return { ok: false, error: checks.failure() };

  const core: PatchOutput = { summary, edits, docUpdate: primaryUpdate(docUpdates, ctx.primaryBlock), docUpdates, threads };
  if (needsMoreContext.length > 0) core.needsMoreContext = needsMoreContext;
  return { ok: true, value: { core, edits: edits as ParsedPatch["edits"], docUpdates, threads } };
}

/** Parse + fully validate `agent/1` (spec §5.5). `files_changed` is advisory (the diff decides); unusable entries are dropped. */
export function parseAgent(raw: { structured?: unknown; text?: string }, ctx: TaskCtx): Result<ParsedAgent, ParseFailure> {
  const body = payload(raw);
  if (!body.ok) return body;
  const checks = new Checks();
  const o = body.value;
  if (!isObject(o)) {
    checks.add("", "an agent/1 object", o);
    return { ok: false, error: checks.failure() };
  }

  const summary = summaryOf(o, checks);
  const reported = stringList(o.files_changed, "/files_changed", CONTRACT_LIMITS.filesChangedMax, 1000, checks);
  const filesChanged: RepoPath[] = [];
  for (const f of reported) {
    const p = parseRepoPath(f);
    if (p.ok) filesChanged.push(p.value);
  }
  let notes: string | undefined;
  if (o.notes !== undefined) {
    if (typeof o.notes !== "string") checks.add("/notes", "a string", o.notes);
    else if (o.notes.length > CONTRACT_LIMITS.notesMaxChars) checks.add("/notes", `at most ${CONTRACT_LIMITS.notesMaxChars} characters`, o.notes);
    else notes = o.notes;
  }
  const docUpdates = parseDocUpdates(o.doc_updates, ctx, checks);
  const threads = parseThreads(o.threads, ctx.taskThreads, checks);
  if (!checks.ok) return { ok: false, error: checks.failure() };

  const core: ParsedAgent["core"] = { summary, filesChanged, docUpdate: primaryUpdate(docUpdates, ctx.primaryBlock), docUpdates, threads };
  if (notes !== undefined) core.notes = notes;
  return { ok: true, value: { core, docUpdates, threads } };
}

function summaryOf(o: Json, checks: Checks): string {
  const s = o.summary;
  if (typeof s !== "string") {
    checks.add("/summary", "a string", s);
    return "";
  }
  if (s.length < 1 || s.length > CONTRACT_LIMITS.summaryMaxChars) checks.add("/summary", `1–${CONTRACT_LIMITS.summaryMaxChars} characters`, s);
  return s;
}

function stringList(v: unknown, at: string, max: number, itemMax: number, checks: Checks): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    checks.add(at, "an array of strings", v);
    return [];
  }
  if (v.length > max) checks.add(at, `at most ${max} items`, v);
  const out: string[] = [];
  v.slice(0, max).forEach((item, i) => {
    if (typeof item !== "string") checks.add(`${at}/${i}`, "a string", item);
    else if (item.length > itemMax) checks.add(`${at}/${i}`, `at most ${itemMax} characters`, item);
    else out.push(item);
  });
  return out;
}

function parseEdits(v: unknown, ctx: { write: RepoPath[] }, checks: Checks): PatchEdit[] {
  if (!Array.isArray(v)) {
    checks.add("/edits", "an array", v);
    return [];
  }
  if (v.length > CONTRACT_LIMITS.editsMax) checks.add("/edits", `at most ${CONTRACT_LIMITS.editsMax} edits`, v);
  const write = new Set(ctx.write);
  const out: PatchEdit[] = [];
  let changed = 0;
  for (const [i, item] of v.slice(0, CONTRACT_LIMITS.editsMax).entries()) {
    const at = `/edits/${i}`;
    if (!isObject(item)) {
      checks.add(at, "an edit object", item);
      continue;
    }
    const before = checks.count;
    const path = typeof item.path === "string" ? parseRepoPath(item.path) : null;
    if (!path?.ok) checks.add(`${at}/path`, "a repo-relative path", item.path);
    else if (!write.has(path.value)) checks.add(`${at}/path`, "a path listed in WRITE", path.value, "E_SCOPE_VIOLATION");
    if (!Number.isInteger(item.start) || (item.start as number) < 1) checks.add(`${at}/start`, "an integer ≥ 1", item.start);
    if (item.end !== undefined && !Number.isInteger(item.end)) checks.add(`${at}/end`, "an integer (or omitted for an insert)", item.end);
    if (typeof item.first_line !== "string") checks.add(`${at}/first_line`, 'a string (the original text of line start, "" for an insert)', item.first_line);
    else if (item.first_line.length > CONTRACT_LIMITS.firstLineMaxChars || /[\r\n]/u.test(item.first_line))
      checks.add(`${at}/first_line`, `one line of at most ${CONTRACT_LIMITS.firstLineMaxChars} characters`, item.first_line);
    else if (isInsert(item) && normLine(item.first_line) !== "")
      // An insert names no original line; a first_line here usually means a replacement whose `end` was forgotten.
      checks.add(`${at}/first_line`, '"" for an insert (give end to replace lines start..end)', item.first_line);
    if (typeof item.new_text !== "string") checks.add(`${at}/new_text`, "a string", item.new_text);
    else {
      const lines = newTextLines(item.new_text).length;
      if (lines > CONTRACT_LIMITS.editNewTextMaxLines || utf8Length(item.new_text) > CONTRACT_LIMITS.editNewTextMaxBytes) {
        checks.add(`${at}/new_text`, `at most ${CONTRACT_LIMITS.editNewTextMaxLines} lines and ${CONTRACT_LIMITS.editNewTextMaxBytes} bytes`, `${lines} lines`);
      }
    }
    if (item.base !== undefined && (typeof item.base !== "string" || !CONTRACT_LIMITS.baseRe.test(item.base)))
      checks.add(`${at}/base`, "7–64 lowercase hex characters", item.base);
    if (checks.count > before) continue;

    const edit: PatchEdit = {
      path: (path as { value: RepoPath }).value,
      start: item.start as number,
      newText: item.new_text as string,
      firstLine: item.first_line as string,
    };
    if (item.end !== undefined) edit.end = item.end as number;
    if (item.base !== undefined) edit.base = item.base as string;
    changed += Math.max(newTextLines(edit.newText).length, edit.end !== undefined && edit.end >= edit.start ? edit.end - edit.start + 1 : 0);
    out.push(edit);
  }
  if (changed > CONTRACT_LIMITS.patchChangedLinesMax) {
    checks.add(
      "/edits",
      `at most ${CONTRACT_LIMITS.patchChangedLinesMax} changed lines in total (a change this large belongs to agent mode)`,
      `${changed} lines`,
      "E_PATCH_APPLY",
    );
  }
  return out;
}

/** `end` omitted or before `start` (only meaningful once both are integers). */
function isInsert(item: Json): boolean {
  return item.end === undefined || (Number.isInteger(item.end) && Number.isInteger(item.start) && (item.end as number) < (item.start as number));
}

function parseDocUpdates(v: unknown, ctx: Pick<TaskCtx, "docBlocks" | "blockKinds">, checks: Checks): DocUpdate[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    checks.add("/doc_updates", "an array", v);
    return [];
  }
  if (v.length > CONTRACT_LIMITS.docUpdatesMax) checks.add("/doc_updates", `at most ${CONTRACT_LIMITS.docUpdatesMax} updates`, v);
  const known = new Set<string>(ctx.docBlocks);
  const seen = new Set<string>();
  const out: DocUpdate[] = [];
  for (const [i, item] of v.slice(0, CONTRACT_LIMITS.docUpdatesMax).entries()) {
    const at = `/doc_updates/${i}`;
    if (!isObject(item)) {
      checks.add(at, "an object {block, md}", item);
      continue;
    }
    const before = checks.count;
    if (typeof item.block !== "string" || !known.has(item.block)) checks.add(`${at}/block`, "a DOC block id from the bundle", item.block);
    else if (seen.has(item.block)) checks.add(`${at}/block`, "each block at most once", item.block);
    if (typeof item.md !== "string") checks.add(`${at}/md`, "a string", item.md);
    else {
      if (item.md.length > CONTRACT_LIMITS.docUpdateMaxChars) checks.add(`${at}/md`, `at most ${CONTRACT_LIMITS.docUpdateMaxChars} characters`, item.md);
      const kind = typeof item.block === "string" ? ctx.blockKinds[item.block as BlockId] : undefined;
      for (const why of markdownProblems(item.md, kind === "heading")) checks.add(`${at}/md`, why, item.md);
    }
    if (checks.count > before) continue;
    seen.add(item.block as string);
    out.push({ block: item.block as BlockId, md: item.md as string });
  }
  return out;
}

function parseThreads(v: unknown, taskThreads: readonly ThreadId[], checks: Checks): ThreadOutcome[] {
  // A thread the engine did not mention is not an error: the review engine applies the "not reported" rule (spec §2.4.4).
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    checks.add("/threads", "an array", v);
    return [];
  }
  const known = new Set<string>(taskThreads);
  const seen = new Set<string>();
  const out: ThreadOutcome[] = [];
  for (const [i, item] of v.entries()) {
    const at = `/threads/${i}`;
    if (!isObject(item)) {
      checks.add(at, "an object {id, status, body}", item);
      continue;
    }
    const before = checks.count;
    if (typeof item.id !== "string" || !known.has(item.id)) checks.add(`${at}/id`, "a TASK thread id from the bundle", item.id);
    else if (seen.has(item.id)) checks.add(`${at}/id`, "each thread exactly once", item.id);
    if (!(STATUSES as readonly unknown[]).includes(item.status)) checks.add(`${at}/status`, STATUSES.join(" | "), item.status);
    if (typeof item.body !== "string") checks.add(`${at}/body`, "a string", item.body);
    else if (item.body.length > CONTRACT_LIMITS.threadBodyMaxChars)
      checks.add(`${at}/body`, `at most ${CONTRACT_LIMITS.threadBodyMaxChars} characters`, item.body);
    if (checks.count > before) continue;
    seen.add(item.id as string);
    out.push({ id: item.id as ThreadId, status: item.status as ThreadOutcome["status"], body: item.body as string });
  }
  return out;
}

function primaryUpdate(updates: readonly DocUpdate[], primary: BlockId | null): string | null {
  return primary === null ? null : (updates.find((u) => u.block === primary)?.md ?? null);
}

const HTML_TAG_RE = /<\/?[A-Za-z][^>\n]*>|<!--|<![A-Za-z]|<\?/u;
const HEADING_RE = /^ {0,3}#{1,6}(?:\s|$)/mu;

/** Reasons an engine-written block must be refused: raw HTML (also ID comments), headings in a non-heading block. Code is data, not markup. */
function markdownProblems(md: string, headingBlock: boolean): string[] {
  const visible = md
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|(?![\s\S]))|(?![\s\S]))/gmu, "")
    .replace(/(`+)[^`\n]*?\1/gu, "");
  const out: string[] = [];
  if (HTML_TAG_RE.test(visible)) out.push("no raw HTML, no ID comments");
  if (!headingBlock && HEADING_RE.test(visible)) out.push("no headings in a non-heading block");
  return out;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}
