/**
 * @mitori/server — `settings/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import {
  type EffectiveSettings,
  type GlobalSettings,
  type RepoSettings,
  type Sha256,
  type TrustRecord,
  type TrustState,
  unsupported,
  unsupportedValue,
  type WorkspaceInfo,
  type WorkspaceOverrides,
} from "@mitori/core";

/** Built-in defaults of the global settings (the WP-00 golden; budgets in bench/budgets/*.json mirror the limits). */
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = unsupportedValue<GlobalSettings>("server.DEFAULT_GLOBAL_SETTINGS");

/**
 * Resolve effective settings: defaults ← global ← workspace override ← repo (only keys whose SETTING_SCOPES row
 * includes `repo`; others go to `ignoredRepoKeys` + `notice.settings.ignoredRepoKeys`). `denyGlobs` =
 * DEFAULT_DENY_GLOBS ∪ global.security.denyGlobs ∪ repo.denyGlobs ∪ `<docDir>/**`; gates/rules need trust. Pure.
 */
export function resolveSettings(input: {
  global: GlobalSettings;
  overrides: WorkspaceOverrides;
  repoRaw: unknown;
  info: WorkspaceInfo;
  trust: (item: TrustRecord["item"], hash: Sha256) => TrustState;
  sandbox: EffectiveSettings["gateSandbox"];
}): EffectiveSettings & { repoParsed: RepoSettings } {
  return unsupported("server.resolveSettings", input);
}

/** Validate a `PATCH /settings` patch: any path under EXEC_SETTING_KEYS ⇒ `E_FORBIDDEN_KEY` (decreases of `limits.*` allowed). Pure. */
export function checkSettingsPatch(patch: unknown, current: GlobalSettings): { ok: true } | { ok: false; paths: string[] } {
  return unsupported("server.checkSettingsPatch", patch, current);
}
