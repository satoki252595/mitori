/** Read-only git helpers for the history replay (test-only; spawns `git` directly). */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function git(cwd: string, args: string[], input?: string): Uint8Array {
  const p = Bun.spawnSync(["git", "-c", "core.quotepath=off", ...args], {
    cwd,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout;
}

/** The crit clone (env `MITORI_CRIT_DIR`, the corpus cache, or the design scratchpad), or null. */
export function critDir(): string | null {
  const cands = [
    process.env.MITORI_CRIT_DIR,
    join(homedir(), ".cache/mitori-corpus/crit@406875dd31e0"),
    "/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/refs/crit",
  ];
  for (const c of cands) if (c && existsSync(join(c, ".git"))) return c;
  return null;
}

/** Commits oldest first. */
export function commits(dir: string): string[] {
  return new TextDecoder()
    .decode(git(dir, ["rev-list", "--reverse", "HEAD"]))
    .trim()
    .split("\n");
}

/** One changed path between two commits (`-M` renames). */
export interface Change {
  status: "M" | "A" | "D" | "R";
  path: string;
  to: string;
}

/** `git diff --name-status -M` without binaries. */
export function changes(dir: string, from: string, to: string): Change[] {
  const bin = new Set<string>();
  for (const l of new TextDecoder().decode(git(dir, ["diff", "--numstat", "-M", from, to])).split("\n")) {
    const m = /^-\t-\t(.*)$/.exec(l);
    if (m) bin.add((m[1] as string).replace(/.*=> /, "").replace(/[{}]/g, ""));
  }
  const out: Change[] = [];
  for (const l of new TextDecoder().decode(git(dir, ["diff", "--name-status", "-M", from, to])).split("\n")) {
    if (!l) continue;
    const [st, a, b] = l.split("\t") as [string, string, string | undefined];
    const s = st[0] as string;
    if (s === "R" && b) out.push({ status: "R", path: a, to: b });
    else if (s === "M" || s === "A" || s === "D") out.push({ status: s, path: a, to: a });
  }
  return out.filter((c) => !bin.has(c.path) && !bin.has(c.to));
}

/** File texts `<rev>:<path>` via one `cat-file --batch` (null for missing or binary). */
export function show(dir: string, specs: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (specs.length === 0) return out;
  const buf = git(dir, ["cat-file", "--batch"], `${specs.join("\n")}\n`);
  const dec = new TextDecoder();
  let pos = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, pos);
    const header = dec.decode(buf.subarray(pos, nl));
    pos = nl + 1;
    if (header.endsWith(" missing")) {
      out.set(spec, null);
      continue;
    }
    const size = Number(header.split(" ")[2]);
    const body = buf.subarray(pos, pos + size);
    pos += size + 1;
    out.set(spec, body.includes(0) || size > 512 * 1024 ? null : dec.decode(body));
  }
  return out;
}
