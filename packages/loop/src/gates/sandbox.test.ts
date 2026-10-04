// ADR-0013 R2 (cr-requests/agent.md #8): the gate's own loopback is usable, nothing of the host is. Profile shape,
// listener snapshots (netstat / lsof), the fail-closed rules of the runner, and the Linux network namespace.
import { describe, expect, test } from "bun:test";
import type { Spawner } from "@mitori/agent";
import type { Cancel, GateSpec } from "@mitori/core";
import { createSecretScanner } from "@mitori/core";
import { createGateRunner } from "./runner.ts";
import {
  ALWAYS_DENIED_LOOPBACK_PORTS,
  DENIED_MACH_SERVICES,
  type LoopbackPolicy,
  mergeListeners,
  parseLsofListeners,
  parseNetstatListeners,
  sandboxed,
  seatbeltProfile,
} from "./sandbox.ts";

const paths = {
  tree: "/m/repos/ws/tmp/j/tree",
  jobTmp: "/m/repos/ws/tmp/j/tmp",
  cargoTarget: "/m/cache/cargo/ws",
  userHome: "/Users/u",
  mitoriHome: "/m",
  claudeEntries: ["/Users/u/.claude"],
  exists: () => true,
};

describe("ADR-0013 R2 seatbelt loopback", () => {
  test("no snapshot ⇒ loopback denied like the rest of the network (the previous profile)", () => {
    const p = seatbeltProfile(paths);
    expect(p).toContain("(deny network*)");
    expect(p).not.toContain('(remote ip "localhost:*")');
    expect(p).not.toContain('(local ip "localhost:*")');
  });

  test("a snapshot ⇒ own loopback allowed; the snapshot's ports, the privileged range and ftp-proxy denied AFTER the allowance", () => {
    const p = seatbeltProfile({ ...paths, loopback: { tcp: [49590, 7890], udp: [53535] } });
    const allow = p.indexOf('(allow network-outbound (remote ip "localhost:*"))');
    expect(allow).toBeGreaterThan(p.indexOf("(deny network*)"));
    expect(p).toContain('(allow network-bind network-inbound (local ip "localhost:*"))');
    const deny = p.indexOf("(deny network-outbound ");
    expect(deny).toBeGreaterThan(allow);
    for (const r of ['(remote tcp "localhost:49590")', '(remote tcp "localhost:7890")', '(remote udp "localhost:53535")', '(remote tcp "localhost:8021")']) {
      expect(p).toContain(r);
    }
    expect(p).toContain('(remote tcp "localhost:22")');
    expect(p).toContain('(remote udp "localhost:53")');
    // a TCP listener's number is not denied for UDP (the gate's own UDP socket may get the same number)
    expect(p).not.toContain('(remote udp "localhost:49590")');
    expect(ALWAYS_DENIED_LOOPBACK_PORTS).toContain(1023);
    expect(ALWAYS_DENIED_LOOPBACK_PORTS).not.toContain(1024);
  });

  test("unix sockets only under the writable dirs (no mDNSResponder / Docker / nix daemon); keychain, LaunchServices, pasteboard denied", () => {
    const p = seatbeltProfile(paths);
    expect(p).not.toContain("(allow network* (remote unix-socket))");
    expect(p).toContain('(remote unix-socket (subpath "/m/repos/ws/tmp/j/tree") (subpath "/m/repos/ws/tmp/j/tmp")');
    for (const s of DENIED_MACH_SERVICES) expect(p).toContain(`(global-name "${s}")`);
    expect(p).toContain('(global-name-regex #"^com\\.apple\\.lsd\\.")');
  });

  test("Linux: a private network namespace (only lo), no --share-net, the daemons' unix sockets hidden", () => {
    const a = sandboxed("bwrap", { ...paths, loopback: { tcp: [1], udp: [] } }, paths.tree, ["go", "test"]);
    const s = a.join(" ");
    expect(a).toContain("--unshare-net");
    expect(a).not.toContain("--share-net");
    expect(s).toContain("--tmpfs /run/user");
    expect(s).toContain("--tmpfs /nix/var/nix/daemon-socket");
    expect(s).toContain("--ro-bind /dev/null /var/run/docker.sock");
    // the hidden socket dirs come before the writable binds (a tree under /run/user would be bound again after)
    expect(s.indexOf("--tmpfs /run/user")).toBeLessThan(s.indexOf(`--bind ${paths.tree} ${paths.tree}`));
    expect(s).toContain("--tmpfs /m");
    // name-resolution daemons do DNS for the caller: hidden like the container APIs
    for (const d of ["/run/systemd/resolve", "/run/nscd", "/run/avahi-daemon"]) expect(s).toContain(`--tmpfs ${d}`);
  });
});

describe("gate secrets: credential stores of other tools, files vs directories, symlinked dotfiles", () => {
  const dirs = new Set(["/m", "/Users/u/.ssh", "/Users/u/.aws", "/Users/u/.claude", "/Users/u/.docker", "/dotfiles/aws"]);
  const real: Record<string, string> = { "/Users/u/.aws": "/dotfiles/aws", "/Users/u/.netrc": "/dotfiles/netrc" };
  const p = {
    ...paths,
    claudeEntries: ["/Users/u/.claude", "/Users/u/.claude.json"],
    exists: (a: string) => dirs.has(a) || a in real || a === "/Users/u/.claude.json" || a === "/Users/u/.npmrc",
    isDir: (a: string) => dirs.has(a) || dirs.has(real[a] ?? ""),
    realpath: (a: string) => real[a] ?? a,
  };

  test("macOS: credential files and dirs are read-denied, at their realpath too (Seatbelt matches resolved paths)", () => {
    const prof = seatbeltProfile(p);
    const deny = prof.split("\n").find((l) => l.startsWith("(deny file-read*")) ?? "";
    for (const x of ["/Users/u/.netrc", "/Users/u/.npmrc", "/Users/u/.git-credentials", "/Users/u/.docker", "/Users/u/.kube", "/Users/u/.claude.json"])
      expect(deny).toContain(`(subpath "${x}")`);
    // the secret behind the symlink, where Seatbelt sees the read
    expect(deny).toContain('(subpath "/dotfiles/aws")');
    expect(deny).toContain('(subpath "/dotfiles/netrc")');
    // the gate's own tree inside ~/.mitori is re-allowed after the denial
    expect(prof.indexOf("(allow file-read* (subpath")).toBeGreaterThan(prof.indexOf("(deny file-read*"));
  });

  test("Linux: a directory gets a tmpfs, a file /dev/null — a tmpfs over ~/.claude.json made bwrap fail every gate", () => {
    const s = sandboxed("bwrap", p, paths.tree, ["go", "test"]).join(" ");
    expect(s).toContain("--tmpfs /Users/u/.claude ");
    expect(s).toContain("--ro-bind /dev/null /Users/u/.claude.json");
    expect(s).not.toContain("--tmpfs /Users/u/.claude.json");
    expect(s).toContain("--ro-bind /dev/null /Users/u/.netrc");
    expect(s).toContain("--ro-bind /dev/null /Users/u/.npmrc");
    expect(s).toContain("--tmpfs /Users/u/.aws");
    expect(s).toContain("--tmpfs /Users/u/.docker");
    // what does not exist is not mounted over
    expect(s).not.toContain(".kube");
  });
});

describe("ADR-0013 R2 listener snapshots", () => {
  test("netstat: TCP LISTEN and bound UDP on loopback / wildcard; LAN-only and connected sockets ignored", () => {
    const text = [
      "Active Internet connections (including servers)",
      "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)",
      "tcp4       0      0  127.0.0.1.49590        *.*                    LISTEN",
      "tcp46      0      0  *.7000                 *.*                    LISTEN",
      "tcp6       0      0  ::1.631                *.*                    LISTEN",
      "tcp4       0      0  192.168.0.16.5000      *.*                    LISTEN",
      "tcp4       0      0  127.0.0.1.49590        127.0.0.1.62001        ESTABLISHED",
      "udp4       0      0  *.5353                 *.*",
      "udp4       0      0  127.0.0.1.53535        *.*",
      "udp4       0      0  192.168.0.16.55947     162.159.133.233.443",
      "tcp6       0      0  fe80::1%lo0.49200      *.*                    LISTEN",
    ].join("\n");
    expect(parseNetstatListeners(text)).toEqual({ tcp: [631, 7000, 49200, 49590], udp: [5353, 53535] });
  });

  test("lsof -F Pn: protocol lines then names; IPv6 brackets; connected UDP takes its local side", () => {
    const text = [
      "p657",
      "f8",
      "PTCP",
      "n*:49152",
      "p709",
      "f3",
      "PTCP",
      "n127.0.0.1:49590",
      "f4",
      "PTCP",
      "n[::1]:8080",
      "PUDP",
      "n*:5353",
      "PUDP",
      "n192.168.0.16:55947->1.2.3.4:443",
      "PUDP",
      "n127.0.0.1:60000->127.0.0.1:53",
      "PUDP",
      "n*:*",
    ].join("\n");
    expect(parseLsofListeners(text)).toEqual({ tcp: [8080, 49152, 49590], udp: [5353, 60000] });
    expect(mergeListeners({ tcp: [2, 1], udp: [] }, { tcp: [1, 3], udp: [9] })).toEqual({ tcp: [1, 2, 3], udp: [9] });
  });
});

describe("ADR-0013 R2 runner: fail closed", () => {
  const gate: GateSpec = {
    id: "custom:t" as GateSpec["id"],
    kind: "custom",
    argvTemplate: ["true"],
    endOfOptions: false,
    cwd: "",
    appliesTo: ["**/*"],
    autofix: false,
    executesRepoCode: true,
    timeoutMs: 1000,
    source: "detected",
    trustHash: "0".repeat(64),
  };

  /** Runs one gate and returns the profile handed to sandbox-exec. */
  async function profileOf(snapshot: LoopbackPolicy | null, registry: string | null): Promise<string> {
    let argv: readonly string[] = [];
    const spawner = {
      spawn(spec: { command: string; argv: readonly string[] }) {
        argv = [spec.command, ...spec.argv];
        const done = (async function* () {})();
        return {
          stdout: done,
          stderr: (async function* () {})(),
          exited: Promise.resolve(0),
          kill: () => undefined,
          write: () => undefined,
          end: () => undefined,
          pid: 1,
        };
      },
    } as unknown as Spawner;
    const files: Record<string, string> = registry === null ? {} : { "/m/daemon.json": registry };
    const fs = {
      stat: (p: string) => (p in files ? { isFile: true, isDir: false, size: 1 } : p === "/m/repos/ws/tmp/j/tree/a.txt" ? { isFile: true } : null),
      read: async (p: string) => new TextEncoder().encode(files[p] ?? ""),
      realpath: (p: string) => p,
      readdir: () => [],
    };
    const runner = createGateRunner({
      spawner,
      fs: fs as never,
      safeWrite: { write: async () => undefined } as never,
      env: { HOME: "/Users/u" },
      home: "/m",
      ws: { key: "ws", root: "/r" },
      clock: { now: () => 0 } as never,
      estimateTokens: (t) => t.length,
      secrets: createSecretScanner(),
      loopbackListeners: async (_: Cancel) => snapshot,
    });
    await runner.run("/m/repos/ws/tmp/j/tree", [gate], ["a.txt"], { consent: false, sandbox: "sandbox-exec" }, new AbortController().signal);
    expect(argv[0]).toBe("/usr/bin/sandbox-exec");
    return argv[2] ?? "";
  }

  test("a snapshot that contains the daemon's own port ⇒ loopback with that port denied", async () => {
    const p = await profileOf({ tcp: [49590, 7890], udp: [] }, '{"port":49590}\n');
    expect(p).toContain('(allow network-outbound (remote ip "localhost:*"))');
    expect(p).toContain('(remote tcp "localhost:49590")');
    expect(p).toContain('(remote tcp "localhost:7890")');
  });

  test("a snapshot that does not see the daemon (the kernel hid the sockets) ⇒ no loopback at all", async () => {
    const p = await profileOf({ tcp: [7890], udp: [] }, '{"port":49590}\n');
    expect(p).not.toContain('(remote ip "localhost:*")');
  });

  test("no snapshot ⇒ no loopback at all", async () => {
    expect(await profileOf(null, '{"port":49590}\n')).not.toContain('(remote ip "localhost:*")');
  });
});
