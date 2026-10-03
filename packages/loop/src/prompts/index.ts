/**
 * @mitori/loop — `prompts/` (owner: WP-08a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 *
 * The four loop system prompts are fixed text in `@mitori/agent` (`LOOP_PROMPTS`, byte-stable per version, `{cwd}` is
 * their only variable). What belongs to the loop is how they are served: the content-addressed system prompt FILE
 * of an engine run carries the workspace-invariant DENY globs and the fixed ACCEPT bullets too (PT-20), so the
 * per-call bundle holds only task-specific lines; and the template objects the bridge renders.
 */

import { LOOP_PROMPTS, type LoopPromptId, type PromptTemplate } from "@mitori/agent";
import type { Glob } from "@mitori/core";
import { AGENT_V1_ENGINE_SCHEMA, FINDINGS_V1_ENGINE_SCHEMA, PATCH_V1_ENGINE_SCHEMA } from "../contract.ts";
import { acceptFixedBullets, denyLine } from "./fixed-lines.ts";

/** Input of {@link loopPromptTemplate}`.render`: the working directory, the workspace's deny globs and the MBF/1 bundle text. */
export interface LoopPromptInput {
  /** `{cwd}` of the engine run (the isolated worktree in agent mode). */
  cwd: string;
  /** `EffectiveSettings.denyGlobs`. */
  deny: readonly Glob[];
  /** `Bundle.text`. */
  bundle: string;
}

const WRITES: ReadonlySet<LoopPromptId> = new Set(["loop.patch", "loop.agent"]);

/**
 * Content of the system prompt file for one prompt id: the versioned text with `{cwd}`, then `DENY …`, then — for
 * the prompts that may edit — the fixed `ACCEPT` bullets. Same inputs ⇒ same bytes (the file is named by its hash).
 */
export function loopSystemPrompt(id: LoopPromptId, ctx: { cwd: string; deny: readonly Glob[] }): string {
  const lines = [LOOP_PROMPTS[id].text.replaceAll("{cwd}", ctx.cwd), denyLine(ctx.deny)];
  if (WRITES.has(id)) lines.push("ACCEPT", ...acceptFixedBullets().map((b) => `- ${b}`));
  return `${lines.join("\n")}\n`;
}

const SCHEMAS: Partial<Record<LoopPromptId, object>> = {
  "loop.patch": PATCH_V1_ENGINE_SCHEMA,
  "loop.findings": FINDINGS_V1_ENGINE_SCHEMA,
  "loop.agent": AGENT_V1_ENGINE_SCHEMA,
};

/** The prompt template of a loop job: `render` gives the system file text and the user message (the bundle). `answer` has no schema (claude-cli streams Markdown). */
export function loopPromptTemplate(id: LoopPromptId): PromptTemplate {
  const p = LOOP_PROMPTS[id];
  const schema = SCHEMAS[id];
  return {
    id,
    version: p.version,
    contract: p.contract,
    render: (input: unknown) => {
      const i = input as LoopPromptInput;
      return { system: loopSystemPrompt(id, i), user: i.bundle };
    },
    ...(schema ? { jsonSchema: schema } : {}),
  };
}
