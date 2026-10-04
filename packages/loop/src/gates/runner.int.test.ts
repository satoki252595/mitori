// LOOP-I-041 / AC-L57 / RT-30: the runner against real tools — gofmt autofix on temp copies, argv only, timeout,
// env scrub, consent for repo-code gates without a sandbox, and the macOS sandbox denying network and secrets.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretScanner, type GateSpec, type JobId } from "@mitori/core";
import { createFsReader, createSafeWriter, createSpawner, detectGateSandbox, systemClock } from "@mitori/platform";
import { createTestHome, type TestHome } from "@mitori/testkit";
import { runOnCopies } from "./copies.ts";
import { createGateRunner, gateEnv } from "./runner.ts";
import { HIDDEN_SOCKET_DIRS } from "./sandbox.ts";

let home: TestHome;
let userHome: string;
beforeEach(async () => {
  home = await createTestHome();
  userHome = join(realpathSync(home.dir), "user-home");
  mkdirSync(join(userHome, ".ssh"), { recursive: true });
  writeFileSync(join(userHome, ".ssh/id_test"), "PRIVATE");
});
afterEach(async () => {
  await home.cleanup();
});

const job = "j_0000000042" as JobId;
const fs = createFsReader();
const safeWrite = createSafeWriter();

function runner(env: Record<string, string | undefined> = {}) {
  return createGateRunner({
    spawner: createSpawner(),
    fs,
    safeWrite,
    env: { PATH: process.env.PATH, HOME: userHome, ANTHROPIC_API_KEY: "sk-ant-should-not-pass", NODE_OPTIONS: "--require evil.js", ...env },
    home: realpathSync(home.dir),
    ws: { key: "ws_gatetest0001", root: realpathSync(home.dir) },
    clock: systemClock,
    estimateTokens: (t) => t.length / 3,
    secrets: createSecretScanner(),
  });
}

const gofmt: GateSpec = {
  id: "fmt:gofmt",
  kind: "format",
  argvTemplate: ["gofmt", "-w", { var: "files" }],
  endOfOptions: true,
  cwd: "",
  appliesTo: ["**/*.go"],
  autofix: true,
  executesRepoCode: false,
  timeoutMs: 20_000,
  source: "detected",
  trustHash: "0".repeat(64),
};

const script = (id: string, code: string, timeoutMs = 20_000): GateSpec => ({
  ...gofmt,
  id: `custom:${id}` as GateSpec["id"],
  kind: "custom",
  argvTemplate: ["sh", "-c", code, "gate", { var: "files" }],
  endOfOptions: false,
  appliesTo: ["**/*"],
  autofix: false,
  executesRepoCode: true,
  timeoutMs,
});

describe("LOOP-I-041 gate runner", () => {
  test("gofmt autofixes a temp copy; the formatted text comes back; unparsable code fails with an excerpt", async () => {
    const deps = { runner: runner(), safeWrite, fs, home: realpathSync(home.dir), ws: "ws_gatetest0001" };
    const ugly = "package meta\n\nconst  maxRetries   =  3\nfunc f( ) {return}\n";
    const r = await runOnCopies(
      deps,
      job,
      [gofmt],
      { "internal/meta/fetch.go": ugly },
      { "go.mod": "module x\n" },
      { consent: false, sandbox: "none" },
      new AbortController().signal,
    );
    expect(r.results).toMatchObject([{ gate: "fmt:gofmt", status: "pass", autofixed: true }]);
    expect(r.files["internal/meta/fetch.go"]).toBe("package meta\n\nconst maxRetries = 3\n\nfunc f() { return }\n");
    const bad = await runOnCopies(deps, job, [gofmt], { "a.go": "package x\nfunc {\n" }, {}, { consent: false, sandbox: "none" }, new AbortController().signal);
    expect(bad.results[0]?.status).toBe("fail");
    expect(bad.results[0]?.excerpt).toContain("a.go:2");
    expect(existsSync(join(home.dir, "repos/ws_gatetest0001/tmp", job, "tree"))).toBe(false);
  });

  test("AC-L57: repo-code gates wait for consent without a sandbox; env is the allowlist + offline values; timeout kills", async () => {
    const r = runner();
    const tree = join(realpathSync(home.dir), "repos/ws_gatetest0001/tmp", job, "tree");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "a.txt"), "x\n");
    const envDump = script("env", 'env | sort > "$TMPDIR/env.txt"');
    const pending = await r.run(tree, [envDump], ["a.txt"], { consent: false, sandbox: "none" }, new AbortController().signal);
    expect(pending).toMatchObject([{ status: "pending_consent" }]);
    const ran = await r.run(tree, [envDump], ["a.txt"], { consent: true, sandbox: "none" }, new AbortController().signal);
    expect(ran).toMatchObject([{ status: "pass" }]);
    const dumped = await Bun.file(join(realpathSync(home.dir), "repos/ws_gatetest0001/tmp", job, "tmp/env.txt")).text();
    expect(dumped).toContain("CI=1");
    expect(dumped).toContain("GOPROXY=off");
    expect(dumped).not.toContain("ANTHROPIC_API_KEY");
    expect(dumped).not.toContain("NODE_OPTIONS");
    expect(Object.keys(gateEnv({ env: { PATH: "/b", FOO: "x" }, home: "/m", ws: { key: "ws", root: "/r" }, fs }, "/m/t")).sort()).toEqual(
      [
        "CARGO_NET_OFFLINE",
        "CARGO_TARGET_DIR",
        "CI",
        "FORCE_COLOR",
        "GOFLAGS",
        "GOPROXY",
        "NO_COLOR",
        "PATH",
        "PIP_NO_INDEX",
        "PYTHONDONTWRITEBYTECODE",
        "TMPDIR",
        "npm_config_offline",
      ].sort(),
    );
    const slow = await r.run(tree, [script("slow", "sleep 30", 300)], ["a.txt"], { consent: true, sandbox: "none" }, new AbortController().signal);
    expect(slow[0]?.status).toBe("timeout");
    // a failing gate stops the later ones
    const two = await r.run(
      tree,
      [script("a-fail", "exit 3"), script("b-later", "exit 0")],
      ["a.txt"],
      { consent: true, sandbox: "none" },
      new AbortController().signal,
    );
    expect(two.map((g) => g.status)).toEqual(["fail", "skipped"]);
  });

  test("nothing a gate starts outlives it: a background job cannot write into the tree after the gate returned", async () => {
    const tree = join(realpathSync(home.dir), "repos/ws_gatetest0001/tmp", job, "tree");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "a.txt"), "x\n");
    const sandbox = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? "sandbox-exec" : "none";
    // the gate passes at once; its background job would plant a link while the agent's next turn reads the tree
    const late = script("late", `(sleep 1; ln -s "${userHome}/.ssh/id_test" late-link) >/dev/null 2>&1 &\nexit 0`);
    const res = await runner().run(tree, [late], ["a.txt"], { consent: true, sandbox }, new AbortController().signal);
    expect(res[0]?.status).toBe("pass");
    await Bun.sleep(1_800);
    expect(existsSync(join(tree, "late-link"))).toBe(false);
  });

  test.if(process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"))(
    "RT-30: inside sandbox-exec a gate can write its tree but not read ~/.ssh, write HOME or reach the network",
    async () => {
      const r = runner();
      const tree = join(realpathSync(home.dir), "repos/ws_gatetest0001/tmp", job, "tree");
      mkdirSync(tree, { recursive: true });
      writeFileSync(join(tree, "a.txt"), "x\n");
      const opts = { consent: false, sandbox: "sandbox-exec" as const };
      const sig = new AbortController().signal;
      expect((await r.run(tree, [script("tree-write", "echo ok > a.txt")], ["a.txt"], opts, sig))[0]).toMatchObject({ status: "pass", sandboxed: true });
      expect((await r.run(tree, [script("ssh-read", `cat ${userHome}/.ssh/id_test`)], ["a.txt"], opts, sig))[0]?.status).toBe("fail");
      expect((await r.run(tree, [script("home-write", `echo x > ${userHome}/pwned`)], ["a.txt"], opts, sig))[0]?.status).toBe("fail");
      expect(existsSync(join(userHome, "pwned"))).toBe(false);
      const net = await r.run(tree, [script("net", "/usr/bin/nc -z -w 2 1.1.1.1 443")], ["a.txt"], opts, sig);
      expect(net[0]?.status).toBe("fail");
    },
  );

  test.if(process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"))(
    "RT-30 (credential stores): a gate cannot read or copy ~/.netrc, ~/.npmrc, ~/.claude.json or a symlinked ~/.aws into the tree; other HOME files stay readable",
    async () => {
      // a HOME outside ~/.mitori (the test home's own user-home is inside it, so everything there is denied anyway)
      const h = realpathSync(mkdtempSync(join(tmpdir(), "mitori-rt30-home-")));
      try {
        writeFileSync(join(h, ".netrc"), "machine example.com password NETRC\n");
        writeFileSync(join(h, ".npmrc"), "//registry.npmjs.org/:_authToken=npm_FAKE\n");
        writeFileSync(join(h, ".claude.json"), '{"oauthAccount":"CLAUDE"}');
        mkdirSync(join(h, "dotfiles/aws"), { recursive: true });
        writeFileSync(join(h, "dotfiles/aws/credentials"), "aws_secret_access_key = FAKE\n");
        symlinkSync(join(h, "dotfiles/aws"), join(h, ".aws"));
        writeFileSync(join(h, "notes.txt"), "not a secret\n");
        const tree = join(realpathSync(home.dir), "repos/ws_gatetest0001/tmp", job, "tree");
        mkdirSync(tree, { recursive: true });
        writeFileSync(join(tree, "a.txt"), "x\n");
        const opts = { consent: false, sandbox: "sandbox-exec" as const };
        const sig = new AbortController().signal;
        const status = async (code: string) => (await runner({ HOME: h }).run(tree, [script("r", code)], ["a.txt"], opts, sig))[0]?.status;
        expect(await status(`cat "$HOME/notes.txt" > notes-copy`)).toBe("pass");
        for (const f of [".netrc", ".npmrc", ".claude.json", ".aws/credentials", "dotfiles/aws/credentials"])
          expect({ f, status: await status(`cp "$HOME/${f}" leaked`) }).toEqual({ f, status: "fail" });
        expect(existsSync(join(tree, "leaked"))).toBe(false);
      } finally {
        rmSync(h, { recursive: true, force: true });
      }
    },
  );
});

/** The httptest test of RT-30b / RT-30L: its own server passes, the daemon's port must not answer. */
const httptestGo = (daemonPort: number) => `package meta

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestServer(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "pong") }))
	defer ts.Close()
	res, err := http.Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	if string(b) != "pong" {
		t.Fatalf("got %q", b)
	}
}

func TestDaemon(t *testing.T) {
	if c, err := net.DialTimeout("tcp", "127.0.0.1:${daemonPort}", 2*time.Second); err == nil {
		c.Close()
		t.Fatal("the daemon's port is reachable")
	}
}
`;

// ADR-0013 R2 (cr-requests/agent.md #8): `httptest.NewServer` style tests pass inside the sandbox; the daemon, the
// host's other loopback services, the outside network and DNS stay out of reach.
describe.if(process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"))("RT-30b gate loopback (macOS)", () => {
  const ws = "ws_gatetest0001";
  // own loopback server + client and DNS in Bun; the deny checks with the system `nc`, whose message keeps the errno
  // (Bun's node:net reports a sandbox EPERM as ECONNREFUSED, which a closed port also gives)
  const probe = `
const out = {};
try {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("pong") });
  out.own = await fetch("http://127.0.0.1:" + server.port + "/").then((r) => r.text(), (e) => "ERR " + (e.code ?? e.message));
  server.stop(true);
} catch (e) {
  out.own = "ERR " + (e.code ?? e.message);
}
out.dns = await require("node:dns").promises.lookup("example.com").then(() => "RESOLVED", (e) => e.code ?? "ERR");
await Bun.write(process.env.TMPDIR + "/probe.json", JSON.stringify(out));
`;
  let daemon: ReturnType<typeof Bun.serve>;
  let proxy: ReturnType<typeof Bun.serve>;
  beforeEach(() => {
    daemon = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("daemon") });
    proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("proxy") });
  });
  afterEach(() => {
    daemon.stop(true);
    proxy.stop(true);
  });

  async function runProbe(registryPort: number) {
    const m = realpathSync(home.dir);
    writeFileSync(join(m, "daemon.json"), `${JSON.stringify({ pid: 1, port: registryPort, token: "t", version: "0", apiVersion: 1 })}\n`);
    const tree = join(m, "repos", ws, "tmp", job, "tree");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "probe.js"), probe);
    const nc = (host: string, port: number) => `/usr/bin/nc -v -z -w 2 ${host} ${port} >> "$TMPDIR/nc.txt" 2>&1`;
    const code = [
      `"${process.execPath}" probe.js`,
      nc("127.0.0.1", daemon.port as number),
      nc("127.0.0.1", proxy.port as number),
      nc("192.0.2.1", 80),
      "true",
    ].join("; ");
    const res = await runner().run(
      tree,
      [script("probe", code, 30_000)],
      ["probe.js"],
      { consent: false, sandbox: "sandbox-exec" },
      new AbortController().signal,
    );
    const tmp = join(m, "repos", ws, "tmp", job, "tmp");
    const read = async (f: string) => (existsSync(join(tmp, f)) ? Bun.file(join(tmp, f)).text() : "");
    const json = await read("probe.json");
    return { res, probe: json ? (JSON.parse(json) as { own: string; dns: string }) : null, nc: (await read("nc.txt")).trim().split("\n") };
  }

  test("a gate serves and fetches on its own loopback port; the daemon's port, a pre-existing listener, 192.0.2.1 and DNS are denied", async () => {
    const { res, probe: p, nc } = await runProbe(daemon.port as number);
    expect(res[0]).toMatchObject({ status: "pass", sandboxed: true });
    expect(p).toEqual({ own: "pong", dns: "ENOTFOUND" });
    expect(nc).toHaveLength(3);
    for (const line of nc) expect(line).toContain("Operation not permitted");
    expect(nc[0]).toContain(`port ${daemon.port}`);
    // the same listeners ARE reachable outside the sandbox: the denial is the profile's, not a closed port
    const outside = Bun.spawnSync(["/usr/bin/nc", "-v", "-z", "-w", "2", "127.0.0.1", String(daemon.port)]);
    expect(outside.exitCode).toBe(0);
  }, 60_000);

  test("fail closed: a snapshot that does not contain the registered daemon port gives the gate no loopback at all", async () => {
    // a registered port nobody listens on ⇒ the snapshot cannot be shown to see the daemon
    const ghost = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    const port = ghost.port as number;
    ghost.stop(true);
    const { probe: p, nc } = await runProbe(port);
    expect(p?.own).toMatch(/^ERR /);
    for (const line of nc) expect(line).toContain("Operation not permitted");
  }, 60_000);

  test.if(Bun.which("go") !== null)(
    "go test with httptest.NewServer passes inside the sandbox; dialing the daemon from the test fails",
    async () => {
      const m = realpathSync(home.dir);
      writeFileSync(join(m, "daemon.json"), `${JSON.stringify({ pid: 1, port: daemon.port, token: "t", version: "0", apiVersion: 1 })}\n`);
      const tree = join(m, "repos", ws, "tmp", job, "tree");
      mkdirSync(join(tree, "meta"), { recursive: true });
      writeFileSync(join(tree, "go.mod"), "module example.com/x\n\ngo 1.22\n");
      writeFileSync(join(tree, "meta/meta_test.go"), httptestGo(daemon.port as number));
      const goTest: GateSpec = {
        ...script("go-test", ""),
        id: "test:go" as GateSpec["id"],
        kind: "test",
        argvTemplate: ["go", "test", "-count=1", { var: "pkgs" }],
        appliesTo: ["**/*.go"],
        timeoutMs: 180_000,
      };
      const res = await runner().run(tree, [goTest], ["meta/meta_test.go"], { consent: false, sandbox: "sandbox-exec" }, new AbortController().signal);
      expect(res[0]?.excerpt ?? "").toBe("");
      expect(res[0]).toMatchObject({ status: "pass", sandboxed: true });
    },
    200_000,
  );
});

// ADR-0013 R2 on Linux: the gate's bwrap has a network namespace of its own (only `lo`), so its loopback is its own
// and nothing of the host's — the daemon on 127.0.0.1 included — is there. Runs where bwrap can make the gate's
// namespaces (the detection probe uses exactly the gate's flags): a Linux desktop, or `docker run --privileged`.
describe.if(process.platform === "linux" && detectGateSandbox() === "bwrap")("RT-30L gate sandbox (Linux bwrap)", () => {
  const ws = "ws_gatetest0001";
  let linuxHome: string;
  let daemon: ReturnType<typeof Bun.serve>;
  beforeEach(() => {
    // a HOME outside /tmp (the gate gets a fresh /tmp): its secrets must be hidden by the sandbox's own rules
    linuxHome = mkdtempSync(join(homedir(), ".mitori-rt30l-"));
    mkdirSync(join(linuxHome, ".ssh"), { recursive: true });
    writeFileSync(join(linuxHome, ".ssh/id_test"), "PRIVATE");
    // Claude Code's own state: a directory AND a file (a tmpfs cannot be mounted over a file)
    mkdirSync(join(linuxHome, ".claude"), { recursive: true });
    writeFileSync(join(linuxHome, ".claude/.credentials.json"), '{"token":"CLAUDE"}');
    writeFileSync(join(linuxHome, ".claude.json"), '{"oauthAccount":"CLAUDE"}');
    writeFileSync(join(linuxHome, ".netrc"), "machine example.com password NETRC\n");
    daemon = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("daemon") });
  });
  afterEach(() => {
    daemon.stop(true);
    rmSync(linuxHome, { recursive: true, force: true });
  });

  const probe = (daemonPort: number) => `
const fs = require("node:fs");
const err = (e) => "ERR " + (e?.code ?? e?.name ?? e?.message ?? String(e));
const out = {};
try {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("pong") });
  out.own = await fetch("http://127.0.0.1:" + server.port + "/").then((r) => r.text(), err);
  server.stop(true);
} catch (e) {
  out.own = err(e);
}
out.daemon = await fetch("http://127.0.0.1:${daemonPort}/", { signal: AbortSignal.timeout(3000) }).then((r) => r.text(), err);
out.net = await fetch("http://192.0.2.1/", { signal: AbortSignal.timeout(3000) }).then(() => "REACHED", err);
out.dns = await require("node:dns").promises.lookup("example.com").then(() => "RESOLVED", (e) => e.code ?? "ERR");
for (const [k, f] of [["ssh", "/.ssh/id_test"], ["netrc", "/.netrc"], ["claudeJson", "/.claude.json"], ["claudeDir", "/.claude/.credentials.json"]]) {
  try {
    out[k] = fs.readFileSync(process.env.HOME + f, "utf8");
  } catch (e) {
    out[k] = err(e);
  }
}
// what the agent's next turn would read if the gate could copy it into the tree
try {
  fs.copyFileSync(process.env.HOME + "/.netrc", "leaked");
  out.copy = "COPIED";
} catch (e) {
  out.copy = err(e);
}
try {
  fs.writeFileSync(process.env.HOME + "/pwned", "x");
  out.home = "WROTE";
} catch (e) {
  out.home = err(e);
}
fs.writeFileSync("own.txt", "tree is writable");
fs.writeFileSync(process.env.TMPDIR + "/probe.json", JSON.stringify(out));
`;

  test("a gate serves and fetches on its own loopback; the host's loopback (the daemon), the network and DNS are not there; ~/.ssh hidden, HOME read-only", async () => {
    const m = realpathSync(home.dir);
    const tree = join(m, "repos", ws, "tmp", job, "tree");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "probe.js"), probe(daemon.port as number));
    const res = await runner({ HOME: linuxHome }).run(
      tree,
      [script("probe", `"${process.execPath}" probe.js`, 30_000)],
      ["probe.js"],
      { consent: false, sandbox: "bwrap" },
      new AbortController().signal,
    );
    expect(res[0]).toMatchObject({ status: "pass", sandboxed: true });
    const out = JSON.parse(readFileSync(join(m, "repos", ws, "tmp", job, "tmp/probe.json"), "utf8")) as Record<string, string>;
    expect(out.own).toBe("pong");
    // the daemon's port is closed in the gate's namespace; from the host it answers
    expect(out.daemon).toMatch(/^ERR /);
    expect(await fetch(`http://127.0.0.1:${daemon.port}/`).then((r) => r.text())).toBe("daemon");
    expect(out.net).toMatch(/^ERR /);
    expect(out.dns).not.toBe("RESOLVED");
    expect(out.ssh).toMatch(/^ERR /);
    expect(out.claudeDir).toMatch(/^ERR /);
    // files are hidden behind /dev/null (a device node in the user namespace: EACCES), not by a tmpfs (which bwrap
    // cannot mount over a file — the gate itself would not start)
    for (const k of ["netrc", "claudeJson", "copy"]) expect({ k, v: out[k] }).toEqual({ k, v: "ERR EACCES" });
    expect(existsSync(join(tree, "leaked"))).toBe(false);
    expect(out.home).toMatch(/^ERR /);
    expect(existsSync(join(linuxHome, "pwned"))).toBe(false);
    expect(readFileSync(join(tree, "own.txt"), "utf8")).toBe("tree is writable");
  }, 60_000);

  // the hidden socket dirs this user can create a socket in (a Linux desktop: /run/user/<uid>, the session bus, the
  // rootless Docker / Podman API, gpg- and ssh-agent; the rest in a container started with a tmpfs owned by the user)
  const uid = process.getuid?.() ?? 0;
  const socketDirs = HIDDEN_SOCKET_DIRS.map((d) => (d === "/run/user" ? `${d}/${uid}` : d)).filter((d) => {
    try {
      accessSync(d, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  });
  test.if(socketDirs.length > 0)(
    "unix sockets under the hidden dirs (session bus, container APIs, name resolution) are not there for the gate; from the host they answer",
    async () => {
      const socks = socketDirs.map((d) => join(d, `mitori-rt30l-${process.pid}.sock`));
      const servers = socks.map((unix) => Bun.listen({ unix, socket: { open: (s) => void s.end("hello"), data() {} } }));
      try {
        const m = realpathSync(home.dir);
        const tree = join(m, "repos", ws, "tmp", job, "tree");
        mkdirSync(tree, { recursive: true });
        writeFileSync(
          join(tree, "sock.js"),
          `const out = {};\nfor (const unix of ${JSON.stringify(socks)}) out[unix] = await Bun.connect({ unix, socket: { data() {} } }).then(() => "CONNECTED", (e) => "ERR " + (e?.code ?? e?.message));\nrequire("node:fs").writeFileSync(process.env.TMPDIR + "/sock.json", JSON.stringify(out));\n`,
        );
        const res = await runner({ HOME: linuxHome }).run(
          tree,
          [script("sock", `"${process.execPath}" sock.js`, 30_000)],
          ["sock.js"],
          { consent: false, sandbox: "bwrap" },
          new AbortController().signal,
        );
        expect(res[0]).toMatchObject({ status: "pass", sandboxed: true });
        const inside = JSON.parse(readFileSync(join(m, "repos", ws, "tmp", job, "tmp/sock.json"), "utf8")) as Record<string, string>;
        for (const sock of socks) expect({ sock, r: inside[sock]?.slice(0, 4) }).toEqual({ sock, r: "ERR " });
        for (const unix of socks) {
          const outside = await Bun.connect({ unix, socket: { data() {} } }).then(
            (s) => {
              s.end();
              return "CONNECTED";
            },
            (e: unknown) => String(e),
          );
          expect({ unix, outside }).toEqual({ unix, outside: "CONNECTED" });
        }
      } finally {
        for (const s of servers) s.stop(true);
        for (const s of socks) rmSync(s, { force: true });
      }
    },
    60_000,
  );

  test.if(Bun.which("go") !== null)(
    "go test with httptest.NewServer passes inside bwrap; dialing the daemon from the test fails",
    async () => {
      const m = realpathSync(home.dir);
      const tree = join(m, "repos", ws, "tmp", job, "tree");
      mkdirSync(join(tree, "meta"), { recursive: true });
      writeFileSync(join(tree, "go.mod"), "module example.com/x\n\ngo 1.22\n");
      writeFileSync(join(tree, "meta/meta_test.go"), httptestGo(daemon.port as number));
      const goTest: GateSpec = {
        ...script("go-test", ""),
        id: "test:go" as GateSpec["id"],
        kind: "test",
        argvTemplate: ["go", "test", "-count=1", { var: "pkgs" }],
        appliesTo: ["**/*.go"],
        timeoutMs: 180_000,
      };
      const res = await runner({ HOME: linuxHome }).run(
        tree,
        [goTest],
        ["meta/meta_test.go"],
        { consent: false, sandbox: "bwrap" },
        new AbortController().signal,
      );
      expect(res[0]?.excerpt ?? "").toBe("");
      expect(res[0]).toMatchObject({ status: "pass", sandboxed: true });
    },
    200_000,
  );
});
