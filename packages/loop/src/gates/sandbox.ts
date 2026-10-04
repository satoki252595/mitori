// OS sandbox for gates (ADR-0013 3): no network; writes only to the worktree (or temp-copy tree), the job TMPDIR
// and CARGO_TARGET_DIR — never to the tree's own `.git` pointer (mitori's later version-control calls in the
// worktree must not be redirected by the code under test, WP-08c); reads of ~/.ssh ~/.aws ~/.config/gh ~/.mitori ~/.claude* and the keychains denied (the
// gate's own tree inside ~/.mitori is re-allowed). macOS: `sandbox-exec -p <SBPL>`, Linux: `bwrap`.

/** Paths the profile is built from (all absolute realpaths). */
export interface SandboxPaths {
  /** The tree the gate runs in (writable). */
  tree: string;
  /** Job TMPDIR (writable). */
  jobTmp: string;
  /** CARGO_TARGET_DIR (writable). */
  cargoTarget: string;
  /** Further writable build caches owned by mitori (the per-workspace GOCACHE; never the user's own caches). */
  caches?: readonly string[];
  /** The user's HOME. */
  userHome: string | null;
  /** `~/.mitori`. */
  mitoriHome: string;
  /** Entries of the user's HOME named `.claude*` (Linux: hidden one by one). */
  claudeEntries: readonly string[];
  /** Which of the sensitive dirs exist (Linux binds over existing paths only). */
  exists(abs: string): boolean;
}

const sbplString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const sbplRegex = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

/** Directories whose contents a gate may never read. */
export function sensitiveDirs(p: Pick<SandboxPaths, "userHome" | "mitoriHome">): string[] {
  const out = [p.mitoriHome];
  if (p.userHome) out.push(`${p.userHome}/.ssh`, `${p.userHome}/.aws`, `${p.userHome}/.config/gh`, `${p.userHome}/Library/Keychains`, `${p.userHome}/.gnupg`);
  return out;
}

/** macOS Seatbelt profile. Later rules win, so the gate's own tree is re-allowed after the ~/.mitori denial. */
export function seatbeltProfile(p: SandboxPaths): string {
  const writable = [p.tree, p.jobTmp, p.cargoTarget, ...(p.caches ?? [])];
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(allow network* (remote unix-socket))",
    "(deny file-write*)",
    `(allow file-write* ${writable.map((d) => `(subpath ${sbplString(d)})`).join(" ")} (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))`,
    `(deny file-write* (subpath ${sbplString(`${p.tree}/.git`)}))`,
    `(deny file-read* ${sensitiveDirs(p)
      .map((d) => `(subpath ${sbplString(d)})`)
      .join(" ")}${p.userHome ? ` (regex #"^${sbplRegex(p.userHome)}/\\.claude")` : ""})`,
    `(allow file-read* ${writable.map((d) => `(subpath ${sbplString(d)})`).join(" ")})`,
  ];
  return `${lines.join("\n")}\n`;
}

/** The argv prefix that runs `argv` inside the sandbox (`none` ⇒ unchanged). */
export function sandboxed(kind: "sandbox-exec" | "bwrap" | "none", p: SandboxPaths, cwd: string, argv: readonly string[]): string[] {
  if (kind === "none") return [...argv];
  if (kind === "sandbox-exec") return ["/usr/bin/sandbox-exec", "-p", seatbeltProfile(p), ...argv];
  const args = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
  for (const d of sensitiveDirs(p)) if (p.exists(d)) args.push("--tmpfs", d);
  for (const e of p.claudeEntries) if (p.exists(e)) args.push("--tmpfs", e);
  for (const d of [p.tree, p.jobTmp, p.cargoTarget, ...(p.caches ?? [])]) if (p.exists(d)) args.push("--bind", d, d);
  if (p.exists(`${p.tree}/.git`)) args.push("--ro-bind", `${p.tree}/.git`, `${p.tree}/.git`);
  args.push("--unshare-net", "--unshare-pid", "--die-with-parent", "--new-session", "--chdir", cwd, "--", ...argv);
  return args;
}
