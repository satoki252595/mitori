/**
 * @mitori/loop — `bundle/` (owner: WP-08a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 *
 * MBF/1 (`mitori.bundle/1`) is frozen with this WP: any later byte change bumps `FORMAT.bundle`.
 *
 * Grammar as built (spec §4.1 with revision R1):
 * - engine modes (answer / findings / patch / agent) carry no `DENY` and none of the fixed ACCEPT bullets: both live in
 *   the content-addressed system prompt file (`loopSystemPrompt`, PT-20). `ACCEPT` appears only for task-specific
 *   bullets (the trusted gates, a doc_edit's "new DOC text is true").
 * - `copy` is self-contained: `DENY`, the full ACCEPT block and `DO`. `pull` has only the doc_edit bullet and `DO`
 *   (its skill states the rest) and no GATE line (mitori runs no gates there).
 * - `GATE` lists the trusted gate ids; when none is trusted it lists all ids followed by ` (untrusted)`.
 * - `OMITTED` entries are `KIND=count`; untrusted rule files show as `RULES=untrusted`.
 */
import type { BundleBuilder } from "../contract.ts";
import { build } from "./build.ts";
import { copyPrompt } from "./copy.ts";
import type { BundleBuilderDeps } from "./deps.ts";
import { repairMessage } from "./repair.ts";

export type { BundleBuilderDeps } from "./deps.ts";

/** Create the bundle builder (pure over its ports; p95 ≤ 100 ms for an M-tier bundle). */
export function createBundleBuilder(deps: BundleBuilderDeps): BundleBuilder {
  return {
    build: (input, budgetTokens) => build(deps, input, budgetTokens),
    repair: (input) => repairMessage(deps, input),
    copyPrompt: (req) => copyPrompt(deps, req),
  };
}
