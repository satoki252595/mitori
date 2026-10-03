import type { FactKind, LineNo } from "@mitori/core";
import type { FactCandidate, FactEvidence, FactExtractInput } from "../contract.ts";

/** Build a candidate for the current file. `data` holds kind-specific fields (never values of env/secrets). */
export function candidate(
  detector: string,
  kind: FactKind,
  input: Pick<FactExtractInput, "file">,
  line: LineNo,
  data: FactCandidate["data"],
  evidence: FactEvidence[] = [],
): FactCandidate {
  return { detector, kind, path: input.file.path, line, data, evidence, scope: input.file.scope };
}

/** Env variable names the detectors accept (spec §5.2 `env.js@1`). */
export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
