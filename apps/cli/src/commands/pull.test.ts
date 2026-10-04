/**
 * The Pull commands against a scripted daemon (loop spec §10.2–§10.7): `bundle`, `reply` (no resolve, `--body-file`
 * limits, SEC-04), `touch` (zero output, AC-L74), `check`, `digest`, `open`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./index.ts";
import { ApiFail, type FakeDaemon, startFakeDaemon, summary, testIo, WS } from "./test/fake-daemon.ts";

const TH = "th_k3f9a2cq";
let d: FakeDaemon;
beforeEach(async () => {
  d = await startFakeDaemon();
});
afterEach(() => d.cleanup());
const io = (argv: string[], o: { env?: Record<string, string>; stdin?: string; cwd?: string } = {}) =>
  testIo({ argv, home: d.home, cwd: o.cwd ?? d.repo, ...(o.env ? { env: o.env } : {}), ...(o.stdin !== undefined ? { stdin: o.stdin } : {}) });

describe("mitori bundle (spec §10.2)", () => {
  test("pull mode: GET …/bundle with budget, mode and --lines; the MBF/1 text verbatim", async () => {
    d.route("GET /ws/:ws/threads/:th/bundle", () => "mitori.bundle/1 th_k3f9a2cq mode=pull\nASK\n> 直して\nEND");
    const t = io([TH, "--budget", "6000", "--lines"]);
    expect(await runCommand("bundle", t)).toBe(0);
    expect(t.stdout).toBe("mitori.bundle/1 th_k3f9a2cq mode=pull\nASK\n> 直して\nEND\n");
    const q = d.calls("GET /ws/:ws/threads/:th/bundle")[0]?.query;
    expect([q?.get("budget"), q?.get("mode"), q?.get("lines")]).toEqual(["6000", "pull", "1"]);
  });

  test("defaults to 4,000 tokens; budget > 12,000 or a bad thread id is a usage error (exit 2)", async () => {
    d.route("GET /ws/:ws/threads/:th/bundle", () => "x");
    await runCommand("bundle", io([TH]));
    expect(d.calls("GET /ws/:ws/threads/:th/bundle")[0]?.query.get("budget")).toBe("4000");
    expect(await runCommand("bundle", io([TH, "--budget", "20000"]))).toBe(2);
    expect(await runCommand("bundle", io(["th_BAD"]))).toBe(2);
    expect(await runCommand("bundle", io([]))).toBe(2);
  });

  test("copy mode builds the Copy-as-prompt text from the thread (POST /prompt)", async () => {
    d.route("GET /ws/:ws/threads/:th", () => ({
      id: TH,
      intent: "change",
      title: "t",
      anchor: { primary: "code" },
      messages: [{ by: "human", body: "直して" }],
    }));
    d.route("POST /ws/:ws/prompt", (c) => ({
      text: `PROMPT ${(c.body as { ask: string; target: string }).ask} ${(c.body as { target: string }).target}`,
      tokens: 3,
    }));
    const t = io([TH, "--mode", "copy", "--target", "codex"]);
    expect(await runCommand("bundle", t)).toBe(0);
    expect(t.stdout).toBe("PROMPT 直して codex\n");
  });
});

describe("CLI-I-005 mitori reply (spec §10.3)", () => {
  const ok = () => d.route("POST /ws/:ws/threads/:th/reply", () => ({ id: TH, state: "answered", round: 2 }));

  test("--done with the text; agent label header; one line `ok <th> → <state> (round n)`", async () => {
    ok();
    const t = io([TH, "--done", "retry を 2 回にしました"], { env: { CODEX_SANDBOX: "seatbelt" } });
    expect(await runCommand("reply", t)).toBe(0);
    expect(t.stdout).toBe(`ok ${TH} → answered (round 2)\n`);
    const call = d.calls("POST /ws/:ws/threads/:th/reply")[0];
    expect(call?.body).toEqual({ kind: "done", body: "retry を 2 回にしました" });
    expect(call?.headers.get("x-mitori-agent")).toBe("codex");
  });

  test("exactly one kind; the body from one source; `-` reads stdin; there is no resolve", async () => {
    ok();
    expect(await runCommand("reply", io([TH, "answer text"]))).toBe(2);
    expect(await runCommand("reply", io([TH, "--done", "--answer", "x"]))).toBe(2);
    expect(await runCommand("reply", io([TH, "--answer"]))).toBe(2);
    expect(await runCommand("reply", io([TH, "--resolve", "x"]))).toBe(2);
    expect(await runCommand("reply", io([TH, "--question", "-"], { stdin: "どちらの挙動が正しい？\n" }))).toBe(0);
    expect(d.calls("POST /ws/:ws/threads/:th/reply")[0]?.body).toEqual({ kind: "question", body: "どちらの挙動が正しい？\n" });
  });

  test("bodies over 8,000 characters are refused before any request", async () => {
    ok();
    const t = io([TH, "--answer", "x".repeat(8001)]);
    expect(await runCommand("reply", t)).toBe(1);
    expect(t.stderr).toMatch(/^error E_PAYLOAD_TOO_LARGE: /);
    expect(d.calls("POST /ws/:ws/threads/:th/reply")).toEqual([]);
  });

  test("--files become repo-relative; a path outside the repository is refused", async () => {
    ok();
    expect(await runCommand("reply", io([TH, "--done", "x", "--files", `src/a.ts,${d.repo}/src/b.ts, src/a.ts`]))).toBe(0);
    expect(d.calls("POST /ws/:ws/threads/:th/reply")[0]?.body).toMatchObject({ files: ["src/a.ts", "src/b.ts"] });
    const t = io([TH, "--done", "x", "--files", "../../etc/passwd"]);
    expect(await runCommand("reply", t)).toBe(1);
    expect(t.stderr).toMatch(/E_PATH_OUTSIDE/);
  });

  test("SEC-04 --body-file: regular files in the repo or <docDir>/tmp only — never deny-listed, outside, or a symlink", async () => {
    ok();
    writeFileSync(join(d.repo, "src/reply.md"), "長い返信\n");
    mkdirSync(join(d.repo, ".mitori/tmp"), { recursive: true });
    writeFileSync(join(d.repo, ".mitori/tmp/r.md"), "from tmp\n");
    writeFileSync(join(d.repo, ".env"), "TOKEN=x\n");
    writeFileSync(join(d.repo, "src/Server.PEM"), "-----BEGIN-----\n");
    mkdirSync(join(d.repo, ".github/workflows"), { recursive: true });
    writeFileSync(join(d.repo, ".github/workflows/ci.yml"), "on: push\n");
    writeFileSync(join(d.dir, "outside.md"), "outside\n");
    symlinkSync(join(d.dir, "outside.md"), join(d.repo, "src/link.md"));
    expect(await runCommand("reply", io([TH, "--answer", "--body-file", "src/reply.md"]))).toBe(0);
    expect(await runCommand("reply", io([TH, "--answer", "--body-file", ".mitori/tmp/r.md"]))).toBe(0);
    expect(d.calls("POST /ws/:ws/threads/:th/reply").map((c) => (c.body as { body: string }).body)).toEqual(["長い返信\n", "from tmp\n"]);
    for (const bad of [".env", "src/Server.PEM", ".github/workflows/ci.yml", "../outside.md", "src/link.md", ".mitori/config.json"]) {
      const t = io([TH, "--answer", "--body-file", bad]);
      expect({ bad, code: await runCommand("reply", t) }).toEqual({ bad, code: 1 });
      expect(t.stderr).toMatch(/error E_(PATH_OUTSIDE|NOT_FOUND): /);
    }
    expect(d.calls("POST /ws/:ws/threads/:th/reply").length).toBe(2);
  });
});

describe("CLI-I-006 / AC-L74 mitori touch --stdin", () => {
  const payload = (file: string) => JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file }, cwd: d.repo });

  test("without a daemon: exit 0, zero bytes on both streams, at once", async () => {
    d.registry(null);
    const t = io(["--stdin", "--source", "claude-hook"], { stdin: payload(join(d.repo, "src/a.ts")) });
    const t0 = performance.now();
    expect(await runCommand("touch", t)).toBe(0);
    expect(performance.now() - t0).toBeLessThan(2_000); // no daemon wait (generous deadline under load)
    expect([t.stdout, t.stderr]).toEqual(["", ""]);
  });

  test("a registered workspace gets POST /ws/:ws/touch with the absolute paths; other paths are ignored", async () => {
    d.route("POST /ws/:ws/touch", () => ({ staleBlocks: 1, registered: true }));
    const t = io(["--stdin"], { stdin: payload(join(d.repo, "src/a.ts")) });
    expect(await runCommand("touch", t)).toBe(0);
    expect([t.stdout, t.stderr]).toEqual(["", ""]);
    const call = d.calls("POST /ws/:ws/touch")[0];
    expect(call?.path).toBe(`/ws/${WS}/touch`);
    expect(call?.body).toEqual({ paths: [join(d.repo, "src/a.ts")], source: "claude-hook" });
    expect(call?.headers.get("x-mitori-client")).toBe("hook/9.9.9");
    const other = io(["--stdin"], { stdin: payload("/elsewhere/x.ts") });
    expect(await runCommand("touch", other)).toBe(0);
    expect(d.calls("POST /ws/:ws/touch").length).toBe(1);
    // never opens a workspace (SEC-21)
    expect(d.calls("POST /workspaces")).toEqual([]);
  });

  test("daemon errors, garbage stdin and bad flags still print nothing and exit 0", async () => {
    d.route("POST /ws/:ws/touch", () => {
      throw new ApiFail(500, "E_INTERNAL", "boom");
    });
    chmodSync(join(d.home, "daemon.json"), 0o644); // a world-readable registry is warned about elsewhere, never here
    for (const t of [io(["--stdin"], { stdin: payload(join(d.repo, "a")) }), io(["--stdin"], { stdin: "not json" }), io(["--bogus"])]) {
      expect(await runCommand("touch", t)).toBe(0);
      expect([t.stdout, t.stderr]).toEqual(["", ""]);
    }
  });
});

describe("mitori check (spec §10.4)", () => {
  test("a prep output path is gen-output; errors print as ≤ 20 `<at>: expected …` lines, exit 1", async () => {
    const out = join(d.repo, ".mitori/tmp/prep/pr_abcdefgh/out/gt_0123456789.ndjson");
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, "{}\n");
    const errors = Array.from({ length: 23 }, (_, i) => ({ at: `${out}:${i + 1}`, expected: "a block line", actual: "{}", code: "E_GEN_OUTPUT_INVALID" }));
    d.route("POST /ws/:ws/check", () => ({ ok: false, errors }));
    const t = io([out]);
    expect(await runCommand("check", t)).toBe(1);
    expect(d.calls("POST /ws/:ws/check")[0]?.body).toEqual({ kind: "gen-output", path: out });
    const lines = t.stdout.trimEnd().split("\n");
    expect(lines.length).toBe(21);
    expect(lines[0]).toBe(`${out}:1: expected a block line, got {} [E_GEN_OUTPUT_INVALID]`);
    expect(lines[20]).toBe("… 3 more");
  });

  test("valid ⇒ exit 0; an unknown kind of file is a usage error", async () => {
    d.route("POST /ws/:ws/check", () => ({ ok: true, errors: [] }));
    writeFileSync(join(d.repo, "x.txt"), "x");
    expect(await runCommand("check", io(["x.txt", "--kind", "doc"]))).toBe(0);
    expect(d.calls("POST /ws/:ws/check")[0]?.body).toEqual({ kind: "doc", path: "x.txt" });
    expect(await runCommand("check", io(["x.txt"]))).toBe(2);
    expect(await runCommand("check", io([]))).toBe(2);
  });
});

describe("mitori digest (spec §10.7)", () => {
  test("one line for a known workspace; nothing without a daemon or outside every workspace", async () => {
    d.route("GET /ws/:ws", () => ({ rev: 12, counts: { openThreads: 3, staleBlocks: 1, runningJobs: 0 } }));
    const t = io([]);
    expect(await runCommand("digest", t)).toBe(0);
    expect(t.stdout).toBe('mitori: doc r12 · open threads 3 · stale blocks 1 · run "mitori review" when asked\n');
    const outside = io([], { cwd: d.dir });
    expect(await runCommand("digest", outside)).toBe(0);
    expect(outside.stdout).toBe("");
    d.registry(null);
    const none = io([]);
    expect(await runCommand("digest", none)).toBe(0);
    expect([none.stdout, none.stderr, none.spawned]).toEqual(["", "", []]);
  });
});

describe("mitori open (portable permalink)", () => {
  test("doc id + block → /d/<doc>/b/<block>; doc id alone → its workspace; unknown doc id → E_NOT_FOUND", async () => {
    d.route("GET /workspaces", () => [summary(d.repo, { docId: "doc_0123456789ab" })]);
    const t = io(["doc_0123456789ab#b_k3f9a2cq", "--no-open"]);
    expect(await runCommand("open", t)).toBe(0);
    expect(t.stdout).toBe(`${d.origin}/d/doc_0123456789ab/b/b_k3f9a2cq\n`);
    const w = io(["doc_0123456789ab", "--no-open"]);
    expect(await runCommand("open", w)).toBe(0);
    expect(w.stdout).toBe(`${d.origin}/w/${WS}\n`);
    const u = io(["doc_zzzzzzzzzzzz", "--no-open"]);
    expect(await runCommand("open", u)).toBe(1);
    expect(u.stderr).toMatch(/E_NOT_FOUND/);
    expect(await runCommand("open", io(["nonsense"]))).toBe(2);
  });

  test("without an id: the cwd's workspace, opened in the browser when no tab is connected", async () => {
    d.route("GET /ws/:ws", () => ({ connectedTabs: 0 }));
    const t = io([]);
    expect(await runCommand("open", t)).toBe(0);
    expect(t.stdout).toBe(`${d.origin}/w/${WS}\n`);
    expect(t.opened).toEqual([`${d.origin}/auth#n=nonce123&to=/w/${WS}`]);
  });
});
