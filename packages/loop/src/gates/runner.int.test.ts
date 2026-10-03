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
    const r = await runOnCopies(deps, job, [gofmt], { "internal/meta/fetch.go": ugly }, { "go.mod": "module x\n" }, { consent: false, sandbox: "none" }, new AbortController().signal);
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
      ["CARGO_NET_OFFLINE", "CARGO_TARGET_DIR", "CI", "FORCE_COLOR", "GOFLAGS", "GOPROXY", "NO_COLOR", "PATH", "PIP_NO_INDEX", "PYTHONDONTWRITEBYTECODE", "TMPDIR", "npm_config_offline"].sort(),
    );
    const slow = await r.run(tree, [script("slow", "sleep 30", 300)], ["a.txt"], { consent: true, sandbox: "none" }, new AbortController().signal);
    expect(slow[0]?.status).toBe("timeout");
    // a failing gate stops the later ones
    const two = await r.run(tree, [script("a-fail", "exit 3"), script("b-later", "exit 0")], ["a.txt"], { consent: true, sandbox: "none" }, new AbortController().signal);
    expect(two.map((g) => g.status)).toEqual(["fail", "skipped"]);
  });

  test.if(process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"))("RT-30: inside sandbox-exec a gate can write its tree but not read ~/.ssh, write HOME or reach the network", async () => {
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
  });
});
