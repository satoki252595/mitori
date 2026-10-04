// argv template expansion (CONS-12): literals stay, `{var}` expands to validated RepoPaths relative to the gate cwd,
// `--` goes before the first expansion when the gate declares `endOfOptions`. A path that would start with `-`
// is prefixed `./` so no file name can turn into an option.
import { type GateSpec, MitoriError, parseRepoPath, type RepoPath } from "@mitori/core";
import picomatch from "picomatch";

const matchers = new Map<string, (p: string) => boolean>();
const matcher = (globs: readonly string[]) => {
  const key = globs.join("\0");
  let m = matchers.get(key);
  if (!m) {
    m = picomatch([...globs], { dot: true });
    matchers.set(key, m);
  }
  return m;
};

/**
 * The changed files a gate applies to: inside its cwd, matching a positive `appliesTo` glob and no `!`-prefixed one
 * (detectors exclude nested manifest directories that have a gate of their own).
 */
export function filesFor(gate: Pick<GateSpec, "cwd" | "appliesTo">, changed: readonly RepoPath[]): RepoPath[] {
  const prefix = gate.cwd === "" ? "" : `${gate.cwd}/`;
  const yes = matcher(gate.appliesTo.filter((g) => !g.startsWith("!")));
  const noGlobs = gate.appliesTo.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  const no = noGlobs.length > 0 ? matcher(noGlobs) : () => false;
  return changed.filter((p) => p.startsWith(prefix) && yes(p) && !no(p)).sort();
}

const relTo = (cwd: string, p: RepoPath): string => {
  const rel = cwd === "" ? p : p.slice(cwd.length + 1);
  return rel.startsWith("-") ? `./${rel}` : rel;
};

const asPath = (rel: string): string => (rel.startsWith("./") ? rel : `./${rel}`);

/** `GateRunner.expand` (pure). */
export function expandGate(
  gate: GateSpec,
  changed: readonly RepoPath[],
  ctx: { pkgsOf(paths: readonly RepoPath[]): string[]; testsOf(paths: readonly RepoPath[]): RepoPath[] },
): string[] {
  const files = filesFor(gate, changed);
  for (const p of files) {
    const r = parseRepoPath(p);
    if (!r.ok) throw new MitoriError("E_INVALID_INPUT", `gate ${gate.id}: not a repository path: ${p}`, { params: { gate: gate.id } });
  }
  const out: string[] = [];
  let expanded = false;
  for (const arg of gate.argvTemplate) {
    if (typeof arg === "string") {
      out.push(arg);
      continue;
    }
    if (!expanded && gate.endOfOptions) out.push("--");
    expanded = true;
    if (arg.var === "files") out.push(...files.map((p) => relTo(gate.cwd, p)));
    // test paths always as `./path`: `bun test` reads a bare argument as a name filter, not as a file
    else if (arg.var === "tests") out.push(...ctx.testsOf(files).map((p) => asPath(relTo(gate.cwd, p))));
    else out.push(...ctx.pkgsOf(files));
  }
  return out;
}
