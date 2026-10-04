// Linux gate-sandbox verification (ADR-0013 decision 3, agent CR #8, nonfunc audit F2), run by scripts/linux-ci.sh:
//   bun scripts/linux/sandbox-check.ts [--out result.json]
// 1. `detectGateSandbox()` — the daemon's own probe (bwrap able to make a user namespace ⇒ "bwrap", else "none").
// 2. When it says "bwrap": the gate argv the loop builds (`sandboxed("bwrap", …)` of packages/loop/src/gates/sandbox.ts,
//    the production profile) runs real commands, and each property of the profile is checked:
//    loopback listen + connect (a Go `httptest` test, the CR #8 case), no outbound network, no writes outside the tree /
//    job TMPDIR / caches, the tree's `.git` read-only, ~/.ssh ~/.aws ~/.mitori hidden, the writable tree really written.
//    The "user home" of the profile is a scratch directory with planted ~/.ssh and ~/.mitori entries: the check never
//    writes into the real HOME (on a developer's Linux box ~/.mitori/state.sqlite is mitori's live state DB). It lies
//    outside /tmp on purpose — the profile mounts a tmpfs over /tmp, which would hide it for the wrong reason.
// Prints a JSON report; exit 1 when a property that must hold does not (exit 0 with `kind: "none"` is a valid result:
// detection degraded, gates fall back to consent).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { sandboxed } from "../../packages/loop/src/gates/sandbox.ts";
import { detectGateSandbox } from "../../packages/platform/src/spawn/sandbox.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" } } });

interface Check {
  name: string;
  want: "ok" | "denied";
  got: "ok" | "denied";
  pass: boolean;
  detail: string;
}

const kind = detectGateSandbox(process.env.PATH ?? "");
const report: { platform: string; kind: string; bwrap: string | null; checks: Check[]; ok: boolean } = {
  platform: `${process.platform}-${process.arch}`,
  kind,
  bwrap: Bun.which("bwrap"),
  checks: [],
  ok: true,
};

if (kind === "bwrap") {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "mitori-sbx-")));
  const tree = join(base, "tree");
  const jobTmp = join(base, "tmp");
  const cargoTarget = join(base, "cargo");
  const gocache = join(base, "gocache");
  for (const d of [tree, jobTmp, cargoTarget, gocache, join(tree, ".git")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(tree, ".git/HEAD"), "ref: refs/heads/main\n");
  const cacheDir = join(homedir(), ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const home = realpathSync(mkdtempSync(join(cacheDir, "mitori-sbx-home-")));
  const secretDir = join(home, ".ssh");
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(join(secretDir, "id_mitori_check"), "PRIVATE KEY (sandbox check)\n");
  const mitoriHome = join(home, ".mitori");
  mkdirSync(mitoriHome, { recursive: true });
  writeFileSync(join(mitoriHome, "state.sqlite"), "state\n");
  try {
    // a Go module whose test listens on loopback (httptest) — go-small's internal/meta tests do this (CR #8)
    writeFileSync(join(tree, "go.mod"), "module example.com/sbx\n\ngo 1.23\n");
    writeFileSync(
      join(tree, "loop_test.go"),
      `package sbx

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "pong") }))
	defer srv.Close()
	res, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	if string(b) != "pong" {
		t.Fatalf("got %q", b)
	}
}
`,
    );
    const paths = {
      tree,
      jobTmp,
      cargoTarget,
      caches: [gocache],
      userHome: home,
      mitoriHome,
      claudeEntries: [] as string[],
      exists: (p: string) => {
        try {
          realpathSync(p);
          return true;
        } catch {
          return false;
        }
      },
    };
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: jobTmp,
      GOCACHE: gocache,
      GOFLAGS: "-modcacherw",
      GOTOOLCHAIN: "local",
      GOPATH: join(base, "gopath"),
    };
    const run = (argv: string[], timeoutMs = 60_000) => {
      const r = Bun.spawnSync(sandboxed("bwrap", paths, tree, argv), { cwd: tree, env, stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
      return { code: r.exitCode ?? -1, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim().slice(-400) };
    };
    const check = (name: string, want: Check["want"], argv: string[], timeoutMs?: number) => {
      const r = run(argv, timeoutMs);
      const got = r.code === 0 ? "ok" : "denied";
      report.checks.push({ name, want, got, pass: got === want, detail: `exit ${r.code}: ${r.out}` });
    };
    const sh = (script: string) => ["/bin/sh", "-c", script];
    check("loopback listen + connect (go test with httptest)", "ok", ["go", "test", "-count=1", "./..."], 180_000);
    check("outbound TCP to 1.1.1.1:443", "denied", ["bun", "-e", "await fetch('https://1.1.1.1/', { signal: AbortSignal.timeout(5000) })"]);
    check("DNS + HTTPS to example.com", "denied", ["bun", "-e", "await fetch('https://example.com/', { signal: AbortSignal.timeout(5000) })"]);
    check("write inside the tree", "ok", sh(`echo ok > ${tree}/written.txt`));
    check("write the job TMPDIR", "ok", sh(`echo ok > ${jobTmp}/t.txt`));
    check("write the user's HOME", "denied", sh(`echo pwned > ${home}/pwned.txt`));
    check("write the tree's .git", "denied", sh(`echo x > ${tree}/.git/HEAD`));
    check("read ~/.ssh", "denied", sh(`cat ${secretDir}/id_mitori_check | grep -q PRIVATE`));
    check("read ~/.mitori", "denied", sh(`cat ${mitoriHome}/state.sqlite | grep -q state`));
    const wrote = (() => {
      try {
        return readFileSync(join(tree, "written.txt"), "utf8").trim() === "ok";
      } catch {
        return false;
      }
    })();
    report.checks.push({ name: "the tree write reached the host", want: "ok", got: wrote ? "ok" : "denied", pass: wrote, detail: "" });
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
}
report.ok = report.checks.every((c) => c.pass);
const text = JSON.stringify(report, null, 2);
console.log(text);
if (values.out) writeFileSync(values.out, `${text}\n`);
process.exit(report.ok ? 0 : 1);
