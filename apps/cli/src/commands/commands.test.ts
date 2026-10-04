/**
 * The TTY rule (loop spec §10 R1, SEC-04) and the human-facing commands: `gen` (push / --prep / --ingest), `install`,
 * `config set`, `init`, `export --html`, `usage`, `stop`, `doctor`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./index.ts";
import { nextCommands } from "./install.ts";
import { ApiFail, type FakeDaemon, startFakeDaemon, testIo, WS } from "./test/fake-daemon.ts";

let d: FakeDaemon;
beforeEach(async () => {
  d = await startFakeDaemon();
});
afterEach(() => d.cleanup());
const io = (argv: string[], o: { env?: Record<string, string>; tty?: boolean; answer?: boolean } = {}) => testIo({ argv, home: d.home, cwd: d.repo, ...o });

describe("TTY rule: spending, publishing and executing commands refuse agents (E_TTY_REQUIRED, exit 2)", () => {
  const cases: [string, string[]][] = [
    ["gen", []],
    ["gen", ["--effort", "complete"]],
    ["init", ["--commit"]],
    ["install", ["claude-code", "--force"]],
    ["config", ["set", "engines.claude-cli.binary", "/usr/local/bin/claude"]],
    ["pr", ["j_0123456789"]],
  ];
  for (const [cmd, argv] of cases)
    test(`${cmd} ${argv.join(" ")}`, async () => {
      for (const env of [{ CLAUDECODE: "1" }, { CODEX_SANDBOX: "seatbelt" }]) {
        const t = io(argv, { env, tty: true });
        expect(await runCommand(cmd, t)).toBe(2);
        expect(t.stderr).toMatch(/^error E_TTY_REQUIRED: /);
      }
      const notty = io(argv, { tty: false });
      expect(await runCommand(cmd, notty)).toBe(2);
      expect(d.seen.filter((s) => s.method !== "GET")).toEqual([]); // nothing was started or written
    });

  test("the agent-safe forms stay open to agents: gen --prep, init without --commit, install without --force", async () => {
    d.route("POST /ws/:ws/gen/prep", () => ({
      id: "pr_abcdefgh",
      phase: 1,
      dir: "/r/.mitori/tmp/prep/pr_abcdefgh",
      fingerprint: "f",
      tasks: 4,
      readme: "/r/.mitori/tmp/prep/pr_abcdefgh/README.md",
      expiresAt: "2026-10-05T00:00:00.000Z",
    }));
    d.route("POST /ws/:ws/init", () => ({ info: { name: "repo", docDir: ".mitori", docCommitted: false } }));
    d.route("GET /integrations", () => []);
    d.route("POST /integrations/:target/install", () => ({ target: "claude-code", scope: "user", files: [], mcp: false }));
    const env = { CLAUDECODE: "1" };
    expect(await runCommand("gen", io(["--prep"], { env }))).toBe(0);
    expect(await runCommand("init", io([], { env }))).toBe(0);
    expect(await runCommand("install", io(["claude"], { env }))).toBe(0);
  });
});

describe("mitori gen (spec §10.5, gL-7)", () => {
  test("--prep prints the four mitori.prep/1 lines", async () => {
    d.route("POST /ws/:ws/gen/prep", (c) => {
      expect(c.body).toEqual({ effort: "overview", scope: ["s3"], continueFrom: "pr_00000000" });
      return {
        id: "pr_abcdefgh",
        phase: 2,
        dir: "/r/.mitori/tmp/prep/pr_abcdefgh",
        fingerprint: "f",
        tasks: 4,
        readme: "/r/.mitori/tmp/prep/pr_abcdefgh/README.md",
        expiresAt: "2026-10-05T00:00:00.000Z",
      };
    });
    const t = io(["--prep", "--effort", "overview", "--scope", "s3", "--continue", "pr_00000000"]);
    expect(await runCommand("gen", t)).toBe(0);
    expect(t.stdout).toBe(
      "mitori.prep/1 id=pr_abcdefgh tasks=4 expires=2026-10-05T00:00:00.000Z\ndir: /r/.mitori/tmp/prep/pr_abcdefgh\nreadme: /r/.mitori/tmp/prep/pr_abcdefgh/README.md\nNEXT: mitori gen --ingest pr_abcdefgh\n",
    );
  });

  test("--ingest reads the fingerprint itself; errors exit 1 with ≤ 20 lines; NEXT for the next phase", async () => {
    const dir = join(d.repo, ".mitori/tmp/prep/pr_abcdefgh");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fingerprint"), "fp123\n");
    d.route("POST /ws/:ws/gen/ingest", () => ({
      ok: false,
      prep: "pr_abcdefgh",
      accepted: { tasks: 3, blocks: 12, claims: 30 },
      errors: [{ at: "out/gt_0123456789.ndjson:4", expected: "a cite", actual: "none", code: "E_GEN_OUTPUT_INVALID" }],
      missing: ["gt_aaaaaaaaaa"],
      coveragePct: 74.6,
      next: { prep: "pr_bbbbbbbb", phase: 2 },
    }));
    const t = io(["--ingest", "pr_abcdefgh", "--model", "claude-sonnet-4-6", "--partial"]);
    expect(await runCommand("gen", t)).toBe(1);
    expect(d.calls("POST /ws/:ws/gen/ingest")[0]?.body).toEqual({ prep: "pr_abcdefgh", fingerprint: "fp123", partial: true, model: "claude-sonnet-4-6" });
    expect(t.stdout).toBe(
      "mitori.ingest/1 prep=pr_abcdefgh ok=false tasks=3 blocks=12 claims=30 coverage=75%\nout/gt_0123456789.ndjson:4: expected a cite, got none [E_GEN_OUTPUT_INVALID]\nmissing: gt_aaaaaaaaaa\nNEXT: mitori gen --prep --continue pr_bbbbbbbb\n",
    );
  });

  test("exit 3 for an expired packet or a missing / rejected fingerprint", async () => {
    expect(await runCommand("gen", io(["--ingest", "pr_zzzzzzzz"]))).toBe(3);
    const dir = join(d.repo, ".mitori/tmp/prep/pr_abcdefgh");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fingerprint"), "old");
    d.route("POST /ws/:ws/gen/ingest", () => {
      throw new ApiFail(410, "E_GEN_PREP_EXPIRED");
    });
    const t = io(["--ingest", "pr_abcdefgh"]);
    expect(await runCommand("gen", t)).toBe(3);
    expect(t.stderr).toMatch(/^error E_GEN_PREP_EXPIRED: /);
    expect(await runCommand("gen", io(["--ingest", "nope"]))).toBe(2);
  });

  test("push: the estimate, a TTY confirmation, then POST /gen/runs (declining starts nothing)", async () => {
    d.route("POST /ws/:ws/gen/estimate", () => ({
      id: "es_aaaaaaaa",
      effort: "standard",
      engine: "claude-cli",
      inTokens: 60_000,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 4_000,
      outTokens: 10_700,
      apiUsd: 1.234,
      seconds: { p50: 300, p90: 500 },
      billing: "subscription-window",
    }));
    d.route("POST /ws/:ws/gen/runs", () => ({ id: "gr_aaaaaaaa", state: "running" }));
    const no = io([], { tty: true, answer: false, env: { LANG: "ja_JP.UTF-8" } });
    expect(await runCommand("gen", no)).toBe(1);
    expect(no.stderr).toContain("見積り: standard · 約 94.7k token · API 換算 $1.23（サブスクの枠内） · 約 5 分 · claude-cli");
    expect(d.calls("POST /ws/:ws/gen/runs")).toEqual([]);
    const yes = io([], { tty: true, answer: true });
    expect(await runCommand("gen", yes)).toBe(0);
    expect(d.calls("POST /ws/:ws/gen/runs")[0]?.body).toEqual({ estimateId: "es_aaaaaaaa", confirm: true });
    expect(yes.stdout).toBe(`gr_aaaaaaaa running ${d.origin}/w/${WS}/gen?run=gr_aaaaaaaa\n`);
  });
});

describe("mitori install (spec §11)", () => {
  test("user scope: the daemon installs; file states and the plugin commands are printed", async () => {
    d.route("GET /integrations", () => []);
    d.route("POST /integrations/:target/install", (c) => {
      expect(c.params.target).toBe("claude-code");
      expect(c.body).toEqual({ scope: "user", mcp: false, force: false });
      return {
        target: "claude-code",
        scope: "user",
        files: [{ path: "/u/.mitori/integrations/claude-code/.claude-plugin/marketplace.json", state: "current" }],
        mcp: false,
      };
    });
    const t = io(["claude"]);
    expect(await runCommand("install", t)).toBe(0);
    expect(t.stdout).toContain("✓ current  /u/.mitori/integrations/claude-code/.claude-plugin/marketplace.json\n");
    expect(t.stdout).toContain("  claude plugin marketplace add ~/.mitori/integrations/claude-code\n  claude plugin install mitori@mitori-local\n");
  });

  test("project scope and agents-md name the workspace; --force shows the edited files and asks first", async () => {
    d.route("GET /integrations", () => [{ target: "agents-md", scope: "project", files: [{ path: "AGENTS.md", state: "modified" }], mcp: false }]);
    d.route("POST /integrations/:target/install", (c) => ({
      target: c.params.target,
      scope: "project",
      files: [{ path: "AGENTS.md", state: "current" }],
      mcp: false,
    }));
    const declined = io(["agents-md", "--force"], { tty: true, answer: false });
    expect(await runCommand("install", declined)).toBe(1);
    expect(declined.stderr).toContain("  AGENTS.md\n");
    expect(d.calls("POST /integrations/:target/install")).toEqual([]);
    const t = io(["agents-md", "--force"], { tty: true, answer: true });
    expect(await runCommand("install", t)).toBe(0);
    expect(d.calls("POST /integrations/:target/install")[0]?.body).toEqual({ scope: "project", ws: WS, mcp: false, force: true });
    expect(await runCommand("install", io(["agents-md", "--scope", "user"]))).toBe(2);
    expect(await runCommand("install", io(["cursor"]))).toBe(2);
  });

  test("next commands per target (update vs first install, --mcp registration)", () => {
    expect(nextCommands("claude-code", "user", false, true)).toEqual([
      "claude plugin marketplace update mitori-local",
      "claude plugin update mitori@mitori-local",
    ]);
    expect(nextCommands("codex", "user", true, false, "/opt/mitori")).toEqual(["codex mcp add mitori -- /opt/mitori mcp"]);
    expect(nextCommands("agents-md", "project", false, false)).toEqual([]);
  });

  test("a daemon without the installer route says where the files are", async () => {
    d.route("GET /integrations", () => {
      throw new ApiFail(501, "E_UNSUPPORTED");
    });
    const t = io(["claude-code"]);
    expect(await runCommand("install", t)).toBe(1);
    expect(t.stderr).toMatch(/hint: .*integrations\//);
  });
});

describe("mitori config set (execution settings, SEC-06)", () => {
  test("shows current → new, asks, then PATCH /settings/exec with confirm: true", async () => {
    d.route("PATCH /settings/exec", (c) => ({ settings: { limits: { genRunMaxUsd: (c.body as { value: number }).value } }, path: "", version: 2 }));
    const t = io(["set", "limits.genRunMaxUsd", "20"], { tty: true, answer: true });
    expect(await runCommand("config", t)).toBe(0);
    expect(d.calls("PATCH /settings/exec")[0]?.body).toEqual({ path: "limits.genRunMaxUsd", value: 20, confirm: true });
    expect(t.stdout).toBe("ok limits.genRunMaxUsd = 20\n");
    expect(await runCommand("config", io(["set", "ui.theme", "dark"], { tty: true }))).toBe(2); // not an execution key
    expect(await runCommand("config", io(["get", "x"], { tty: true }))).toBe(2);
  });
});

describe("mitori export --html (the CLI writes the file)", () => {
  test("writes --out through SafeWriter and reports size and redactions", async () => {
    d.route("POST /ws/:ws/export", (c) => {
      expect(c.body).toEqual({ format: "html", level: "standard", lang: "ja", includeDecisions: false, excerpts: false });
      return { html: "<!doctype html><title>doc</title>", bytes: 2048, sha256: "ab".repeat(32), redactions: 2, codeExcerpts: { count: 0, files: 0 } };
    });
    const t = io(["--html", "--out", "design.html", "--no-excerpts"]);
    expect(await runCommand("export", t)).toBe(0);
    expect(readFileSync(join(d.repo, "design.html"), "utf8")).toBe("<!doctype html><title>doc</title>");
    expect(t.stdout).toBe(`${join(d.repo, "design.html")}\n`);
    expect(t.stderr).toContain("2 redaction(s)");
    expect(await runCommand("export", io(["--out", "x.html"]))).toBe(2);
  });

  test("WP13: -o and --no-code are the short and the plain-words forms (excerpts default on)", async () => {
    const seen: unknown[] = [];
    d.route("POST /ws/:ws/export", (c) => {
      seen.push(c.body);
      return { html: "<!doctype html><title>doc</title>", bytes: 100, sha256: "cd".repeat(32), redactions: 0, codeExcerpts: { count: 3, files: 2 } };
    });
    const t = io(["--html", "-o", "a.html"]);
    expect(await runCommand("export", t)).toBe(0);
    expect(await runCommand("export", io(["--html", "-o", "b.html", "--no-code"]))).toBe(0);
    expect(seen).toEqual([
      { format: "html", level: "standard", lang: "ja", includeDecisions: false, excerpts: true },
      { format: "html", level: "standard", lang: "ja", includeDecisions: false, excerpts: false },
    ]);
    expect(readFileSync(join(d.repo, "b.html"), "utf8")).toContain("<title>doc</title>");
    expect(t.stderr).toContain("3 code excerpt(s) from 2 file(s)");
  });
});

describe("usage / stop / doctor", () => {
  test("usage prints totals per engine and model", async () => {
    const tot = { calls: 3, in: 1200, cacheWrite: 0, cacheRead: 30_000, out: 900, apiUsd: 0.42 };
    d.route("GET /usage/summary", (c) => ({
      range: c.query.get("range"),
      totals: tot,
      byDay: [],
      byEngine: { "claude-cli": tot },
      byModel: { "claude-sonnet-4-6": tot },
      estimateAccuracyPct: 25,
    }));
    const t = io(["--range", "7d"]);
    expect(await runCommand("usage", t)).toBe(0);
    expect(t.stdout.split("\n")[0]).toBe("usage (7d, API-equivalent)");
    expect(t.stdout).toContain("$0.42");
    expect(await runCommand("usage", io(["--range", "year"]))).toBe(2);
  });

  test("stop: POST /daemon/shutdown, then wait until the daemon removed its registry", async () => {
    d.route("POST /daemon/shutdown", () => {
      setTimeout(() => d.registry(null), 20);
      return { ok: true };
    });
    const t = io([]);
    expect(await runCommand("stop", t)).toBe(0);
    expect(d.calls("POST /daemon/shutdown")[0]?.body).toEqual({ reason: "cli" });
    expect(t.stderr).toBe(`mitori: stopped (pid ${process.pid})\n`);
  });

  test("stop with no daemon running says so and exits 0", async () => {
    d.registry(null);
    const none = io([]);
    expect(await runCommand("stop", none)).toBe(0);
    expect(none.stderr).toBe("mitori: no daemon is running\n");
  });

  test("doctor: version, daemon, engines and integration freshness, without starting a daemon", async () => {
    d.route("GET /daemon", () => ({
      version: "9.9.9",
      pid: process.pid,
      port: d.port,
      uptimeSec: 120,
      workspaces: [WS],
      scheduler: {},
      engines: [
        { engine: "claude-cli", installed: false, auth: "none", capabilities: [], billing: "unknown", problems: [], checkedAt: "" },
        { engine: "generic", installed: false, auth: "none", capabilities: [], billing: "unknown", problems: [], checkedAt: "" },
      ],
      rssMb: 40,
    }));
    d.route("GET /integrations", () => [
      {
        target: "claude-code",
        scope: "user",
        files: [
          { path: "a", state: "current" },
          { path: "b", state: "outdated" },
        ],
        mcp: false,
      },
    ]);
    const t = io([]);
    expect(await runCommand("doctor", t)).toBe(1);
    expect(t.stdout).toContain("✓ daemon v9.9.9");
    expect(t.stdout).toContain("! claude-cli: not found"); // the configured engine
    expect(t.stdout).toContain("· generic: not found"); // not used: information only
    expect(t.stdout).toContain("! claude-code (user) outdated: b — mitori install claude-code updates it");
    d.registry(null);
    const none = io([]);
    expect(await runCommand("doctor", none)).toBe(0);
    expect(none.stdout).toContain("daemon: not running");
    expect(none.spawned).toEqual([]);
    expect(await runCommand("doctor", io(["--calibrate"]))).toBe(1);
  });
});
