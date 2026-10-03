/**
 * @mitori/loop — `install/` (owner: WP-11). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Hasher, type Logger, type SafeWriter, unsupported, type WriteQueue } from "@mitori/core";
import type { Installer } from "../contract.ts";

/**
 * Installer factory — GLOBAL, not per workspace (user-scope installs; `POST /integrations/:target/install`) [CONS-22].
 * Hook and MCP entries embed mitori's realpath (`{mitoriBin}`), rewritten by the freshness check [SEC-21].
 */
export function createInstaller(deps: {
  safeWrite: SafeWriter;
  hasher: Hasher;
  home: string;
  userHome: string;
  mitoriBin: string;
  stateWrite: WriteQueue;
  log: Logger;
}): Installer {
  return unsupported("loop.createInstaller", deps);
}

/**
 * Template variants derived from the plugin SKILL.md (spec §11.1–§11.2):
 * - project (`.claude/skills/mitori-review/SKILL.md`): `name: mitori-review`, `/mitori:review` → `/mitori-review`;
 * - codex (`.agents/skills/mitori-review/SKILL.md`): frontmatter `name` + `description` only, step 1 runs
 *   `mitori review --wait-sec 540` (no background execution), step 5 appends `--wait-sec 540`.
 */
export function renderSkill(variant: "plugin" | "project" | "codex"): string {
  return unsupported("loop.renderSkill", variant);
}
