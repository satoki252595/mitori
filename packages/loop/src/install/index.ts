/**
 * @mitori/loop — `install/` (owner: WP-11). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Hasher, Logger, SafeWriter, WriteQueue } from "@mitori/core";
import { createFsReader } from "@mitori/platform";
import type { Installer } from "../contract.ts";
import { makeInstaller } from "./installer.ts";
import { skillVariant } from "./templates.ts";

/**
 * Installer factory — GLOBAL, not per workspace (user-scope installs; `POST /integrations/:target/install`) [CONS-22].
 * Hook and MCP entries embed mitori's realpath (`{mitoriBin}`), rewritten by the freshness check [SEC-21].
 * Project-scope installs (and `agents-md`) take `project: {root, docDir}` in the options object
 * (CR-PENDING(WP-11), installer.ts `InstallOptions`). Installs are serialized in-process; `stateWrite` is not needed
 * (the records are a home file written through SafeWriter, not state.sqlite rows).
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
  return makeInstaller({
    safeWrite: deps.safeWrite,
    hasher: deps.hasher,
    home: deps.home,
    userHome: deps.userHome,
    mitoriBin: deps.mitoriBin,
    log: deps.log.child("install"),
    fs: createFsReader(),
  });
}

/**
 * Template variants derived from the plugin SKILL.md (spec §11.1–§11.2):
 * - project (`.claude/skills/mitori-review/SKILL.md`): `name: mitori-review`, `/mitori:review` → `/mitori-review`;
 * - codex (`.agents/skills/mitori-review/SKILL.md`): frontmatter `name` + `description` only, step 1 runs
 *   `mitori review --wait-sec 540` (no background execution), step 5 appends `--wait-sec 540`.
 */
export function renderSkill(variant: "plugin" | "project" | "codex"): string {
  return skillVariant(variant);
}
