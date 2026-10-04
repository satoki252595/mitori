// OS sandbox for gates (ADR-0013 3, R2): no network except the gate's OWN loopback sockets; writes only to the
// worktree (or temp-copy tree), the job TMPDIR and CARGO_TARGET_DIR — never to the tree's own `.git` pointer
// (mitori's later version-control calls in the worktree must not be redirected by the code under test, WP-08c);
// reads of ~/.mitori, ~/.claude*, the keychains and the credential stores of other tools denied (the gate's own tree
// inside ~/.mitori is re-allowed): a gate may not read them, and so cannot copy them into the tree the next agent turn
// reads. macOS: `sandbox-exec -p <SBPL>`, Linux: `bwrap` with a private network namespace.
//
// Loopback (ADR-0013 R2, cr-requests/agent.md #8): test suites start servers on 127.0.0.1 (`httptest.NewServer`,
// `app.listen(0)`, pytest-httpserver) and talk to them. Linux gets that for free: `--unshare-net` gives the gate a
// network namespace of its own with only `lo` up, so 127.0.0.1 there reaches nothing that runs on the host (the
// mitori daemon, local proxies, databases, a browser's debugging port). macOS has no network namespace; the profile
// emulates one: loopback bind / listen / connect is allowed, but every TCP / UDP port that was already bound on a
// loopback or wildcard address when the gate started — the daemon's port among them, which is also denied by
// name — and the privileged range are denied. Only sockets the gate opened itself are reachable. Without a listener
// snapshot that provably sees the daemon's own port, the profile keeps loopback denied (fail closed).

/** Ports already bound on the host when a gate starts (denied to the gate, macOS). */
export interface LoopbackPolicy {
  /** TCP ports listening on a loopback or wildcard address (includes the daemon's). */
  tcp: readonly number[];
  /** UDP ports bound on a loopback or wildcard address (local DNS forwarders, proxies). */
  udp: readonly number[];
}

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
  /** Which of the sensitive paths exist (Linux binds over existing paths only). */
  exists(abs: string): boolean;
  /**
   * A directory (after symlinks)? Linux hides a directory with a tmpfs and a file with `/dev/null` — a tmpfs cannot be
   * mounted over a file (`~/.claude.json`: bwrap failed every gate). Absent ⇒ every sensitive path counts as a directory.
   */
  isDir?(abs: string): boolean;
  /**
   * realpath (null when missing). macOS matches the RESOLVED path of a read: a secret behind a symlink (dotfile
   * managers link `~/.aws` into a dotfiles repo) is denied at its target too. Absent ⇒ the paths as given.
   */
  realpath?(abs: string): string | null;
  /**
   * macOS: allow the gate's own loopback sockets and deny these pre-existing ports. Absent ⇒ loopback is denied like
   * every other address. (Linux: the private network namespace isolates loopback whatever this says.)
   */
  loopback?: LoopbackPolicy;
}

const sbplString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const sbplRegex = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

/**
 * Credential stores in HOME a gate may never read (relative to HOME). No formatter, compiler or test runner needs one
 * (npm and bun run with `~/.npmrc` unreadable; the gates are offline anyway). Directories: SSH / AWS / gh / GnuPG /
 * Docker registry / kube / gcloud / Azure / pass / 1Password CLI / GNOME keyring / macOS keychains, and Firefox's
 * profiles (plain-text session cookies).
 */
export const SENSITIVE_HOME_DIRS: readonly string[] = [
  ".ssh",
  ".aws",
  ".config/gh",
  "Library/Keychains",
  ".gnupg",
  ".docker",
  ".kube",
  ".config/gcloud",
  ".azure",
  ".password-store",
  ".config/op",
  ".local/share/keyrings",
  "Library/Application Support/Firefox",
  ".mozilla",
];
/** Credential files in HOME (relative): netrc, the credential store of git, npm / PyPI / cargo / gem / Vault / Terraform tokens. */
export const SENSITIVE_HOME_FILES: readonly string[] = [
  ".netrc",
  ".git-credentials",
  ".config/git/credentials",
  ".npmrc",
  ".pypirc",
  ".cargo/credentials",
  ".cargo/credentials.toml",
  ".gem/credentials",
  ".vault-token",
  ".terraform.d/credentials.tfrc.json",
  ".config/hub",
];

/** Directories whose contents a gate may never read (`~/.mitori` and the credential directories of HOME). */
export function sensitiveDirs(p: Pick<SandboxPaths, "userHome" | "mitoriHome">): string[] {
  return [p.mitoriHome, ...(p.userHome ? SENSITIVE_HOME_DIRS.map((d) => `${p.userHome}/${d}`) : [])];
}

/** The sensitive paths as listed: the dirs, the credential files, the `.claude*` entries. */
function listedSecrets(p: SandboxPaths): string[] {
  return [...sensitiveDirs(p), ...(p.userHome ? SENSITIVE_HOME_FILES.map((f) => `${p.userHome}/${f}`) : []), ...p.claudeEntries];
}

/** Every sensitive path, each also at its realpath when that differs (macOS: Seatbelt matches resolved paths). */
export function sensitivePaths(p: SandboxPaths): string[] {
  const listed = listedSecrets(p);
  const out = new Set<string>(listed);
  for (const x of listed) {
    const real = p.realpath?.(x) ?? null;
    if (real !== null && real !== x) out.add(real);
  }
  return [...out];
}

/**
 * macOS services that act for the caller outside its sandbox: the keychain (securityd hands out stored passwords and
 * tokens — `security find-generic-password -w`, the `gh` / git credential helpers), LaunchServices and Apple events
 * (`open https://…?d=<secret>` makes the browser carry data out), background URL sessions (nsurlsessiond fetches for
 * the caller) and the pasteboard. No formatter, compiler or test runner needs them.
 */
export const DENIED_MACH_SERVICES: readonly string[] = [
  "com.apple.SecurityServer",
  "com.apple.securityd.xpc",
  "com.apple.coreservices.launchservicesd",
  "com.apple.coreservices.appleevents",
  "com.apple.nsurlsessiond",
  "com.apple.nsurlsessiond.NSURLSessionProxyService",
  "com.apple.pasteboard.1",
];
const DENIED_MACH_PREFIXES: readonly string[] = ["com.apple.lsd."];

/**
 * Unix-domain sockets (Linux) that reach a service acting outside the sandbox: the Docker / Podman API, the nix daemon,
 * D-Bus — and the name-resolution daemons. A private network namespace stops the gate's own DNS packets, not a lookup
 * a daemon makes for it: glibc's NSS asks systemd-resolved over its varlink socket (`nss-resolve`, Fedora / Arch),
 * nscd, or avahi (`mdns4_minimal`, Ubuntu) — `<secret>.attacker.example` would leave as the daemon's DNS query (the
 * macOS profile closes the same channel by denying mDNSResponder's socket).
 */
export const HIDDEN_SOCKET_DIRS: readonly string[] = [
  "/run/user",
  "/run/dbus",
  "/run/podman",
  "/run/containerd",
  "/nix/var/nix/daemon-socket",
  "/run/systemd/resolve",
  "/run/nscd",
  "/run/avahi-daemon",
];
export const HIDDEN_SOCKET_FILES: readonly string[] = ["/run/docker.sock", "/var/run/docker.sock"];

/**
 * Loopback ports a gate never reaches even when no snapshot lists them: the privileged range (system daemons run as
 * root, which `lsof` cannot see — cupsd 631, sshd 22, a local DNS forwarder on 53, netbiosd 137/138) and macOS's
 * root-owned launchd proxy `ftp-proxy` (127.0.0.1:8021). A test's own server binds port 0 and gets an ephemeral
 * port (≥ 49152).
 */
export const ALWAYS_DENIED_LOOPBACK_PORTS: readonly number[] = [...Array.from({ length: 1023 }, (_, i) => i + 1), 8021];

const portList = (ports: readonly number[]) => [...new Set(ports.filter((n) => Number.isInteger(n) && n > 0 && n < 65536))].sort((a, b) => a - b);

/** macOS Seatbelt profile. Later rules win, so the gate's own tree is re-allowed after the ~/.mitori denial. */
export function seatbeltProfile(p: SandboxPaths): string {
  const writable = [p.tree, p.jobTmp, p.cargoTarget, ...(p.caches ?? [])];
  const under = writable.map((d) => `(subpath ${sbplString(d)})`).join(" ");
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    // unix-domain sockets only inside the writable dirs (a test's own socket in TMPDIR): never mDNSResponder (DNS is
    // a way out), the Docker / OrbStack / nix daemon sockets (they run containers and fetches for the caller) or an agent
    `(allow network-bind network-outbound network-inbound (local unix-socket ${under}) (remote unix-socket ${under}))`,
  ];
  if (p.loopback) {
    const tcp = portList([...ALWAYS_DENIED_LOOPBACK_PORTS, ...p.loopback.tcp]);
    const udp = portList([...ALWAYS_DENIED_LOOPBACK_PORTS, ...p.loopback.udp]);
    lines.push('(allow network-bind network-inbound (local ip "localhost:*"))', '(allow network-outbound (remote ip "localhost:*"))');
    const deny = [...tcp.map((n) => `(remote tcp "localhost:${n}")`), ...udp.map((n) => `(remote udp "localhost:${n}")`)];
    if (deny.length > 0) lines.push(`(deny network-outbound ${deny.join(" ")})`);
  }
  lines.push(
    `(deny mach-lookup ${DENIED_MACH_SERVICES.map((s) => `(global-name ${sbplString(s)})`).join(" ")} ${DENIED_MACH_PREFIXES.map((s) => `(global-name-regex #"^${sbplRegex(s)}")`).join(" ")})`,
    "(deny file-write*)",
    `(allow file-write* ${under} (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))`,
    `(deny file-write* (subpath ${sbplString(`${p.tree}/.git`)}))`,
    // `subpath` of a file is that file; the realpaths cover secrets behind symlinks
    `(deny file-read* ${sensitivePaths(p)
      .map((d) => `(subpath ${sbplString(d)})`)
      .join(" ")}${p.userHome ? ` (regex #"^${sbplRegex(p.userHome)}/\\.claude")` : ""})`,
    `(allow file-read* ${under})`,
  );
  return `${lines.join("\n")}\n`;
}

/** The argv prefix that runs `argv` inside the sandbox (`none` ⇒ unchanged). */
export function sandboxed(kind: "sandbox-exec" | "bwrap" | "none", p: SandboxPaths, cwd: string, argv: readonly string[]): string[] {
  if (kind === "none") return [...argv];
  if (kind === "sandbox-exec") return ["/usr/bin/sandbox-exec", "-p", seatbeltProfile(p), ...argv];
  const args = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
  // a directory gets an empty tmpfs, a file `/dev/null` (bwrap follows a symlinked destination to its target)
  for (const d of listedSecrets(p)) if (p.exists(d)) args.push(...((p.isDir?.(d) ?? true) ? ["--tmpfs", d] : ["--ro-bind", "/dev/null", d]));
  // a read-only bind does not stop connect(2) on a unix socket: hide the dirs and files of the daemons that act for the caller
  for (const d of HIDDEN_SOCKET_DIRS) if (p.exists(d)) args.push("--tmpfs", d);
  for (const f of HIDDEN_SOCKET_FILES) if (p.exists(f)) args.push("--ro-bind", "/dev/null", f);
  for (const d of [p.tree, p.jobTmp, p.cargoTarget, ...(p.caches ?? [])]) if (p.exists(d)) args.push("--bind", d, d);
  if (p.exists(`${p.tree}/.git`)) args.push("--ro-bind", `${p.tree}/.git`, `${p.tree}/.git`);
  // a network namespace of the gate's own: only `lo` (bwrap brings it up), so loopback servers of the test work and
  // nothing of the host — the daemon's port included — is reachable
  args.push("--unshare-net", "--unshare-pid", "--die-with-parent", "--new-session", "--chdir", cwd, "--", ...argv);
  return args;
}

const isLoopbackHost = (host: string) =>
  host === "*" || host === "::" || host === "::1" || host === "0.0.0.0" || host.startsWith("127.") || host.endsWith("%lo0");

/**
 * Ports bound on a loopback or wildcard local address, from `netstat -an -f inet` + `-f inet6` (macOS: every user's
 * sockets, when the kernel lets the caller list them). TCP counts LISTEN sockets only; UDP every bound socket. Local
 * addresses look like `127.0.0.1.8080`, `*.5353`, `::1.631`, `fe80::1%lo0.49152`.
 */
export function parseNetstatListeners(text: string): LoopbackPolicy {
  const tcp: number[] = [];
  const udp: number[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    const proto = f[0]?.startsWith("tcp") ? "tcp" : f[0]?.startsWith("udp") ? "udp" : null;
    if (proto === null || f.length < 5 || (proto === "tcp" && f[5] !== "LISTEN")) continue;
    const local = f[3] ?? "";
    const i = local.lastIndexOf(".");
    const port = Number(local.slice(i + 1));
    if (i > 0 && Number.isInteger(port) && port > 0 && isLoopbackHost(local.slice(0, i))) (proto === "tcp" ? tcp : udp).push(port);
  }
  return { tcp: portList(tcp), udp: portList(udp) };
}

/**
 * The same from `lsof -nP -w -iTCP -sTCP:LISTEN -iUDP -F Pn` (the user's own processes only): `P` lines name the
 * protocol, `n` lines the address — `127.0.0.1:8080`, `*:5353`, `[::1]:631`, `192.168.0.2:5000->1.2.3.4:443`.
 */
export function parseLsofListeners(text: string): LoopbackPolicy {
  const tcp: number[] = [];
  const udp: number[] = [];
  let proto: "tcp" | "udp" | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("P")) proto = line === "PTCP" ? "tcp" : line === "PUDP" ? "udp" : null;
    else if (line.startsWith("n") && proto !== null) {
      const local = line.slice(1).split("->")[0] ?? "";
      const i = local.lastIndexOf(":");
      const port = Number(local.slice(i + 1));
      const host = local.slice(0, i).replace(/^\[(.*)\]$/, "$1");
      if (i > 0 && Number.isInteger(port) && port > 0 && isLoopbackHost(host)) (proto === "tcp" ? tcp : udp).push(port);
    }
  }
  return { tcp: portList(tcp), udp: portList(udp) };
}

/** Union of listener snapshots. */
export function mergeListeners(...ps: readonly LoopbackPolicy[]): LoopbackPolicy {
  return { tcp: portList(ps.flatMap((p) => p.tcp)), udp: portList(ps.flatMap((p) => p.udp)) };
}
