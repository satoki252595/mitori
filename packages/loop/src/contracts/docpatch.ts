import type { BlockId, BlockKind, DocPatchOutput, Result } from "@mitori/core";
import { CONTRACT_LIMITS } from "../contract.ts";
import { Checks, isObject, type ParseFailure, payload } from "./check.ts";
import { markdownProblems } from "./patch.ts";

/** A doc-only output can name only anchored DOC ids; inserts form a forward chain from one of them. */
export function parseDocpatch(
  raw: { structured?: unknown; text?: string },
  ctx: { docBlocks: BlockId[]; blockKinds: Record<BlockId, BlockKind> },
): Result<DocPatchOutput, ParseFailure> {
  const data = payload(raw);
  if (!data.ok) return data;
  const c = new Checks();
  const blocks = isObject(data.value) ? data.value.blocks : undefined;
  if (!Array.isArray(blocks)) {
    c.add("/blocks", "an array of doc block operations", blocks);
    return { ok: false, error: c.failure() };
  }
  if (blocks.length > CONTRACT_LIMITS.docUpdatesMax) c.add("/blocks", `at most ${CONTRACT_LIMITS.docUpdatesMax} operations`, blocks);
  const known = new Set<string>(ctx.docBlocks);
  const seen = new Set<string>();
  const inserted = new Set<string>();
  const deleted = new Set(
    blocks
      .filter(isObject)
      .filter((b) => b.op === "delete")
      .map((b) => b.id),
  );
  const out: DocPatchOutput["blocks"] = [];
  for (const [i, b] of blocks.slice(0, CONTRACT_LIMITS.docUpdatesMax).entries()) {
    const at = `/blocks/${i}`;
    const before = c.count;
    if (!isObject(b)) {
      c.add(at, "a block operation", b);
      continue;
    }
    if (typeof b.id !== "string" || seen.has(b.id)) c.add(`${at}/id`, "a unique block id", b.id);
    if (!["update", "insert", "delete", "keep"].includes(b.op as string)) c.add(`${at}/op`, "update | insert | delete | keep", b.op);
    if (b.op === "insert") {
      if (typeof b.id !== "string" || !/^new:[1-9]\d*$/u.test(b.id)) c.add(`${at}/id`, "new:<positive integer>", b.id);
      if (typeof b.after !== "string" || (!known.has(b.after) && !inserted.has(b.after)) || deleted.has(b.after))
        c.add(`${at}/after`, "an existing DOC block or earlier insert, not deleted", b.after, "E_SCOPE_VIOLATION");
    } else if (typeof b.id !== "string" || !known.has(b.id)) c.add(`${at}/id`, "an anchored DOC block id", b.id, "E_SCOPE_VIOLATION");
    if (b.op === "update" || b.op === "insert") {
      if (typeof b.md !== "string" || b.md.trim() === "" || b.md.length > CONTRACT_LIMITS.docUpdateMaxChars)
        c.add(`${at}/md`, "nonempty Markdown within the doc update limit", b.md);
      else for (const why of markdownProblems(b.md, ctx.blockKinds[b.id as BlockId] === "heading")) c.add(`${at}/md`, why, b.md);
    } else if (b.md !== undefined || b.after !== undefined) c.add(at, "keep/delete have no md or after", b);
    if (b.op !== "insert" && b.after !== undefined) c.add(`${at}/after`, "after belongs only to inserts", b.after);
    if (c.count !== before) continue;
    seen.add(b.id as string);
    if (b.op === "insert") inserted.add(b.id as string);
    out.push(b as unknown as DocPatchOutput["blocks"][number]);
  }
  return c.ok ? { ok: true, value: { blocks: out } } : { ok: false, error: c.failure() };
}

export const DOCPATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      maxItems: CONTRACT_LIMITS.docUpdatesMax,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "op"],
        properties: { id: { type: "string" }, op: { enum: ["update", "insert", "delete", "keep"] }, md: { type: "string" }, after: { type: "string" } },
      },
    },
  },
} as const;
