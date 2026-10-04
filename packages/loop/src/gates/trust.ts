// Gate trust (spec §7.6.2, L8): every gate needs trust before it runs. The human approves the gates of a change as
// ONE set — formatter, type check and tests in one dialog that lists every argv — whose hash covers the member
// specs' hashes (each of which covers its argv template and the configs / lockfile it was detected from). A gate
// trusted on its own (an earlier per-gate decision) stays trusted; an explicit denial of a single gate still wins.
import type { GateSpec, RepoPath } from "@mitori/core";
import { CHECK_CONFIG_NAMES, LOCKFILES } from "./checks.ts";
import { CONFIG_NAMES } from "./detect.ts";

type TrustState = "trusted" | "denied" | "pending";

/** Trust hash of a set of gates. */
export function gateSetHash(sha256: (text: string) => string, specs: readonly GateSpec[]): string {
  return sha256(`mitori.gates-set/1\n${[...new Set(specs.map((s) => s.trustHash))].sort().join("\n")}`);
}

/** Per-gate trust of `specs` with the set rule, plus the hash / state of the set the untrusted rest forms. */
export function gateTrust(
  trust: (hash: string) => TrustState,
  sha256: (text: string) => string,
  specs: readonly GateSpec[],
): { trusted: boolean[]; rest: GateSpec[]; setHash: string | null; set: TrustState } {
  const own = specs.map((s) => trust(s.trustHash));
  const rest = specs.filter((_, i) => own[i] !== "trusted");
  const setHash = rest.length > 0 ? gateSetHash(sha256, rest) : null;
  const set: TrustState = setHash ? trust(setHash) : "trusted";
  return { trusted: own.map((o) => o === "trusted" || (set === "trusted" && o !== "denied")), rest, setHash, set };
}

/** One change of a job tree (relative to its base). */
export interface TreeChange {
  path: RepoPath;
  /** New blob (null = deleted). */
  newOid: string | null;
}

/**
 * File names that decide what a gate runs: the configs / manifests / lockfiles the detectors read (`CONFIG_NAMES`,
 * `CHECK_CONFIG_NAMES`, `LOCKFILES`) and the files a runner loads on its own (`conftest.py`, `build.rs`, JS config
 * modules) — the trust inputs of spec §7.6.2 ("設定が変われば hash が変わり再確認になる").
 */
const TRUST_INPUT_NAMES: ReadonlySet<string> = new Set([...CONFIG_NAMES, ...CHECK_CONFIG_NAMES, ...LOCKFILES, "conftest.py", "build.rs", "setup.py"]);
const TRUST_INPUT_RE = /\.config\.[cm]?[jt]s$|^requirements[^/]*\.txt$/;

const isTrustInput = (path: RepoPath): boolean => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return TRUST_INPUT_NAMES.has(name) || TRUST_INPUT_RE.test(name);
};
/** Trust inputs a runner also loads from directories BELOW its cwd (pytest collects every nested `conftest.py`). */
const NESTED_INPUTS: ReadonlySet<string> = new Set(["conftest.py"]);

/** A changed input at `path` concerns a gate in `cwd`: configs are read from the cwd and its ancestors; a few nested ones too. */
function related(path: RepoPath, cwd: string): boolean {
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash);
  if (dir === cwd || dir === "" || cwd.startsWith(`${dir}/`)) return true;
  return NESTED_INPUTS.has(path.slice(slash + 1)) && (cwd === "" || dir.startsWith(`${cwd}/`));
}

/**
 * The specs as the human must trust them for THIS tree (RT-31 re-trust): a gate whose trust inputs the job's own diff
 * changed (an AI edit of `package.json` scripts, `go.mod`, a lockfile, `conftest.py` …) gets a new trust hash over
 * its detected hash plus the changed inputs' blobs — so it does not run on the strength of the earlier decision.
 */
export function treeSpecs(sha256: (text: string) => string, specs: readonly GateSpec[], changes: readonly TreeChange[]): GateSpec[] {
  const inputs = changes.filter((c) => isTrustInput(c.path));
  if (inputs.length === 0) return [...specs];
  return specs.map((s) => {
    const mine = inputs.filter((c) => related(c.path, s.cwd));
    if (mine.length === 0) return s;
    const lines = mine.map((c) => `${c.path}\0${c.newOid ?? "deleted"}`).sort();
    return { ...s, trustHash: sha256(`mitori.gates-tree/1\n${s.trustHash}\n${lines.join("\n")}`) as GateSpec["trustHash"] };
  });
}

/** The changed trust inputs of a tree, for the trust dialog (empty when the gates are unchanged). */
export function changedTrustInputs(changes: readonly TreeChange[]): RepoPath[] {
  return changes.filter((c) => isTrustInput(c.path)).map((c) => c.path);
}

/** One preview line of a gate: the argv the human trusts, variables as `{files}` / `{pkgs}` / `{tests}` (RT-12). */
export const gatePreview = (spec: GateSpec): string =>
  `${spec.id} (cwd ${spec.cwd || "."}): ${spec.argvTemplate.map((a) => (typeof a === "string" ? a : `{${a.var}}`)).join(" ")}`;
