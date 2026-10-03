// Per-kind allowlists of SafeWriter (core §18 `SafeWriteKind`, ADR-0014 decision 3) [SEC-01].
import { DOC_TEMPLATE, ID_ALPHABET, ID_SPEC, MitoriError, type SafeWriteKind, SLUG_RE } from "@mitori/core";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ID = (kind: "decision" | "prep") => `${ID_SPEC[kind].prefix}[${ID_ALPHABET}]{${ID_SPEC[kind].len}}`;
const SLUG = SLUG_RE.source.replace(/^\^/, "").replace(/\$$/, "");

/** Relative paths the installer writes (loop spec §11), relative to the scope root (`~` or the repo). */
export const INTEGRATION_PATHS = [
  ".claude/skills/mitori-review/SKILL.md",
  ".agents/skills/mitori-review/SKILL.md",
  ".mitori/integrations/claude-code/.claude-plugin/marketplace.json",
  ".mitori/integrations/claude-code/plugins/mitori/.claude-plugin/plugin.json",
  ".mitori/integrations/claude-code/plugins/mitori/skills/review/SKILL.md",
  ".mitori/integrations/claude-code/plugins/mitori/skills/gen/SKILL.md",
  ".mitori/integrations/claude-code/plugins/mitori/hooks/hooks.json",
  ".mitori/integrations/claude-code/plugins/mitori/.mcp.json",
] as const;

/**
 * Allowlist per kind (`rel` relative to the kind's root):
 * - `doc` (root = docDir): DOC_TEMPLATE files, `doc/modules/<slug>.md`, `decisions/dc_<id>.md`, the manifest/index/
 *   config/README/.gitignore, `cache/**`.  - `prep` (root = docDir): `tmp/prep/pr_<id>[/**]`.
 * - `integration`: {@link INTEGRATION_PATHS}.  - `repo_meta` (root = repo): `.gitattributes`, `AGENTS.md`, `CLAUDE.md`.
 * - `accept` (root = repo): any RepoPath (the job's write scope is checked by loop).  - `home` (root = `~/.mitori`): any.
 * Every kind additionally refuses a `.git` segment (any case: case-insensitive filesystems) — see {@link checkRel}.
 */
export const SAFE_WRITE_RULES: Readonly<Record<SafeWriteKind, RegExp>> = {
  doc: new RegExp(
    `^(?:${DOC_TEMPLATE.map((s) => esc(s.file)).join("|")}|doc/modules/${SLUG}\\.md|decisions/${ID("decision")}\\.md|mitori\\.json|doc\\.index\\.json|config\\.json|README\\.md|\\.gitignore|cache/.+)$`,
    "u",
  ),
  prep: new RegExp(`^tmp/prep/${ID("prep")}(?:/.+)?$`, "u"),
  integration: new RegExp(`^(?:${INTEGRATION_PATHS.map(esc).join("|")})$`, "u"),
  repo_meta: /^(?:\.gitattributes|AGENTS\.md|CLAUDE\.md)$/u,
  accept: /^.+$/u,
  home: /^.+$/u,
};

/** Validate `rel` for `kind` and return its segments. `E_PATH_OUTSIDE` on any violation (step 1 of ADR-0014). */
export function checkRel(rel: string, kind: SafeWriteKind): string[] {
  const bad = (why: string): never => {
    throw new MitoriError("E_PATH_OUTSIDE", `refusing to write ${JSON.stringify(rel)} (${kind}): ${why}`, { params: { kind, reason: why } });
  };
  if (typeof rel !== "string" || rel.length === 0) bad("empty");
  if (rel.includes("\0")) bad("nul");
  if (rel.includes("\\")) bad("backslash");
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) bad("absolute");
  const segs = rel.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === "..") bad("dot-or-empty-segment");
    if (s.toLowerCase() === ".git") bad("git-dir");
  }
  if (!SAFE_WRITE_RULES[kind].test(rel)) bad("not-allowed-for-kind");
  return segs;
}
