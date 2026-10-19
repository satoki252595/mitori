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

/**
 * Basenames that read as repo-root files: on screen a bare `README.md:7` is taken for the root file, so a
 * namesake elsewhere always shows a parent directory (WP31). Root files stay bare.
 */
const ROOTLIKE = /^(README(\.md)?|index\.(ts|tsx|js)|__init__\.py|main\.go|lib\.rs|package\.json|Cargo\.toml|go\.mod|Makefile|Dockerfile)$/;

/**
 * Display labels that tell same-named files apart inside one context (one room's file chips, one block's cite
 * chips, one appendix list): files sharing a basename — or carrying a rootlike one (`README.md`, `index.ts`)
 * while living below the root — show the shortest parent prefix that sets them apart (`a/index.ts`,
 * `.cursor-plugin/README.md`); anything already unique keeps its bare basename, root files always do. Labels
 * longer than `max` characters lose their head (`…/…/index.ts`). Order and length of the output follow `paths`.
 */
export function displayPaths(paths: readonly string[], max = 32): string[] {
  return paths.map((p) => {
    const d = p.lastIndexOf("/");
    const base = p.slice(d + 1);
    let label = base;
    // another path in this context with the same basename (contexts are tiny: a room's chips, a block's cites)
    const ambiguous = paths.some((q) => q !== p && q.slice(q.lastIndexOf("/") + 1) === base);
    if (d > 0 && (ambiguous || ROOTLIKE.test(base))) {
      // widen the tail segment by segment until no other path in this context shares it
      let s = d;
      for (;;) {
        const prev = p.lastIndexOf("/", s - 1);
        const cand = p.slice(prev + 1);
        // a rival shares whole segments (`xa/b.ts` must not match the tail `a/b.ts`)
        if (prev < 0 || !paths.some((q) => q !== p && (q === cand || q.endsWith(`/${cand}`)))) {
          label = cand;
          break;
        }
        s = prev;
      }
    }
    if (label.length > max) {
      // drop the head only, never the basename: `…/<kept tail><base>`, or the bare basename when even that
      // overflows (the hover title and the screen-reader label always carry the full path)
      const keep = max - 2 - base.length;
      label = keep > 0 ? `…/${label.slice(label.length - base.length - keep)}` : base;
    }
    return label;
  });
}
