// LOOP-I-041 / AC-L57 / RT-30: the runner against real tools — gofmt autofix on temp copies, argv only, timeout,
// env scrub, consent for repo-code gates without a sandbox, and the macOS sandbox denying network and secrets.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSecretScanner, type GateSpec, type JobId } from "@mitori/core";
import { createFsReader, createSafeWriter, createSpawner, systemClock } from "@mitori/platform";
import { createTestHome, type TestHome } from "@mitori/testkit";
import { runOnCopies } from "./copies.ts";
import { createGateRunner, gateEnv } from "./runner.ts";

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
});

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
      writeFileSync(
        join(tree, "meta/meta_test.go"),
        `package meta

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
	if c, err := net.DialTimeout("tcp", "127.0.0.1:${daemon.port}", 2*time.Second); err == nil {
		c.Close()
		t.Fatal("the daemon's port is reachable")
	}
}
`,
      );
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
