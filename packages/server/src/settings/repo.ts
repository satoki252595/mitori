/**
 * `<docDir>/config.json` (repo scope, committed, untrusted input): keep only keys whose `SETTING_SCOPES` row includes
 * `repo` and whose value validates; everything else is reported in `ignoredRepoKeys` [CONS-25]. The trust items it
 * declares (`gates`, `rules`) are content-hashed here so the resolver and the trust service agree on the hash.
 */
import { createHash } from "node:crypto";
import { canonicalJson, type GateDeclaration, type GateSpec, type RepoSettings, SETTING_SCOPES, type Sha256, SLUG_RE, type TrustRecord } from "@mitori/core";
import { isPlainObject } from "./merge.ts";
import { REPO_SPEC, validate } from "./schema.ts";

/** Default timeout of a repo-declared gate. */
export const REPO_GATE_TIMEOUT_MS = 120_000;

const sha256 = (s: string): Sha256 => createHash("sha256").update(s).digest("hex");

export function parseRepoSettings(raw: unknown): { repo: RepoSettings; ignored: string[] } {
  const repo: RepoSettings = { schemaVersion: 1 };
  const ignored: string[] = [];
  if (raw === undefined || raw === null) return { repo, ignored };
  if (!isPlainObject(raw)) return { repo, ignored: ["*"] };
  const out = repo as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (key === "schemaVersion") {
      if (value !== 1) ignored.push(key);
      continue;
    }
    const row = (SETTING_SCOPES as Record<string, { scopes: readonly string[] } | undefined>)[key];
    const spec = (REPO_SPEC as Record<string, (typeof REPO_SPEC)[keyof typeof REPO_SPEC] | undefined>)[key];
    if (!row?.scopes.includes("repo") || !spec || validate(value, spec).length > 0) {
      ignored.push(key);
      continue;
    }
    out[key] = value;
  }
  if (repo.modules) {
    const modules: NonNullable<RepoSettings["modules"]> = {};
    for (const [prefix, m] of Object.entries(repo.modules)) {
      if (m.slug !== undefined && !SLUG_RE.test(m.slug)) {
        ignored.push(`modules.${prefix}.slug`);
        const { slug: _drop, ...rest } = m;
        modules[prefix] = rest;
      } else modules[prefix] = m;
    }
    repo.modules = modules;
  }
  return { repo, ignored };
}

/** Content hash of a trust item declared by the repo config (null when the repo declares none). */
export function repoTrustHash(repo: RepoSettings, item: Extract<TrustRecord["item"], "gates" | "rules">): Sha256 | null {
  const v = item === "gates" ? repo.gates : repo.rules;
  return v && v.length > 0 ? sha256(canonicalJson(v)) : null;
}

/** A repo-declared gate as a template; conservative flags (it may execute repo code) [SEC-03, CONS-12]. */
export function gateFromDeclaration(d: GateDeclaration): GateSpec {
  const autofix = d.kind === "format";
  const cwd = "";
  return {
    id: d.id,
    kind: d.kind,
    argvTemplate: d.argvTemplate,
    endOfOptions: false,
    cwd,
    appliesTo: d.appliesTo,
    autofix,
    executesRepoCode: true,
    timeoutMs: REPO_GATE_TIMEOUT_MS,
    source: "repo_config",
    trustHash: sha256(canonicalJson({ argvTemplate: d.argvTemplate, cwd, appliesTo: d.appliesTo, autofix })),
  };
}
