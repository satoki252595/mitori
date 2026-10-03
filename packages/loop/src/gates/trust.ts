// Gate trust (spec §7.6.2, L8): every gate needs trust before it runs. The human approves the gates of a change as
// ONE set — formatter, type check and tests in one dialog that lists every argv — whose hash covers the member
// specs' hashes (each of which covers its argv template and the configs / lockfile it was detected from). A gate
// trusted on its own (an earlier per-gate decision) stays trusted; an explicit denial of a single gate still wins.
import type { GateSpec } from "@mitori/core";

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

/** One preview line of a gate: the argv the human trusts, variables as `{files}` / `{pkgs}` / `{tests}` (RT-12). */
export const gatePreview = (spec: GateSpec): string =>
  `${spec.id} (cwd ${spec.cwd || "."}): ${spec.argvTemplate.map((a) => (typeof a === "string" ? a : `{${a.var}}`)).join(" ")}`;
