import type { RepoPath, Result } from "./domain.ts";
import { MitoriError } from "./errors.ts";

/**
 * Validate a repo-relative POSIX path at a trust boundary (HTTP, CLI, agent output; CORE-U-008) and return it
 * NFC-normalized. Rejected (`E_INVALID_INPUT`): empty, absolute (`/x`, `C:…`), backslash, NUL, empty / `.` /
 * `..` segments (so also a leading `./` and a trailing `/`).
 */
export function parseRepoPath(input: string): Result<RepoPath> {
  const fail = (why: string): Result<RepoPath> => ({
    ok: false,
    error: new MitoriError("E_INVALID_INPUT", `invalid repo path: ${why}`, { params: { reason: why } }).toData(),
  });
  if (typeof input !== "string" || input.length === 0) return fail("empty");
  if (input.includes("\u0000")) return fail("nul");
  if (input.includes("\\")) return fail("backslash");
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) return fail("absolute");
  const path = input.normalize("NFC");
  for (const seg of path.split("/")) {
    if (seg === "") return fail("empty-segment");
    if (seg === "." || seg === "..") return fail("dot-segment");
  }
  return { ok: true, value: path };
}

/** {@link parseRepoPath} that throws. */
export function repoPath(input: string): RepoPath {
  const r = parseRepoPath(input);
  if (!r.ok) throw MitoriError.from(r.error);
  return r.value;
}
