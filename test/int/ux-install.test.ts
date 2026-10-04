// UX-INST (finishing pass, track ux): `mitori install` end to end on the REAL daemon — `GET /integrations` and
// `POST /integrations/:target/install` over the global installer (loop spec §11, CONS-22), through the real CLI command.
// A temp `userHome` (never the developer's ~): the user-scope plugin tree, the project skill, the AGENTS.md managed
// block (≤ 80 tokens, between its markers only), sha256 freshness (current → modified by hand → kept → --force).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IntegrationStatusView, WorkspaceKey } from "@mitori/core";
import { estimateTokensRaw } from "@mitori/indexer";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { runCommand } from "../../apps/cli/src/commands/index.ts";
import { testIo } from "../../apps/cli/src/commands/test/fake-daemon.ts";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "./fake-claude.ts";
import { type Int, startInt } from "./harness.ts";

const CLI_VERSION = (JSON.parse(readFileSync(join(import.meta.dir, "../../apps/cli/package.json"), "utf8")) as { version: string }).version;
const BIN = "/opt/mitori/bin/mitori";
let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let userHome: string;

beforeAll(async () => {
  userHome = realpathSync(mkdtempSync(join(tmpdir(), "mitori-userhome-"))); // the installer reports realpaths
  repo = await buildFixture("go-small");
  int = await startInt({ spawner: fakeClaude({ dtMs: 1 }), config: FAKE_CLAUDE_CONFIG, overrides: { userHome, mitoriBin: BIN } });
  ws = (await int.open(repo.root)).ws;
}, 60_000);
afterAll(async () => {
  await int?.close();
  await repo?.dispose();
  rmSync(userHome, { recursive: true, force: true });
});

const views = (q = "") => int.json<IntegrationStatusView[]>("GET", `/integrations${q}`);
const viewOf = (all: IntegrationStatusView[], target: string, scope: string) => all.find((v) => v.target === target && v.scope === scope);
const cli = async (argv: string[], o: { tty?: boolean; answer?: boolean } = {}) => {
  const io = testIo({ argv, home: int.home, cwd: repo.root, env: { HOME: userHome }, ...o });
  io.version = CLI_VERSION;
  const code = await runCommand("install", io);
  return { code, out: io.stdout, err: io.stderr };
};

describe("UX-INST mitori install", () => {
  test("before: every planned file is missing; MCP is not listed until opted in", async () => {
    const all = await views();
    expect(all.map((v) => `${v.target}/${v.scope}`)).toEqual(["claude-code/user", "codex/user"]);
    const cc = viewOf(all, "claude-code", "user");
    expect(cc?.files.every((f) => f.state === "missing" && f.path.startsWith(`${userHome}/.mitori/integrations/claude-code/`))).toBe(true);
    expect(cc?.files.some((f) => f.path.endsWith(".mcp.json"))).toBe(false);
    expect(cc?.mcp).toBe(false);
  });

  test("`mitori install claude-code` (user): the plugin tree is written, current, recorded 0600; the next commands are printed", async () => {
    const r = await cli(["claude-code"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ current  ");
    expect(r.out).toContain("claude plugin marketplace add ~/.mitori/integrations/claude-code");
    expect(r.out).toContain("claude plugin install mitori@mitori-local");
    const root = join(userHome, ".mitori/integrations/claude-code");
    const skill = readFileSync(join(root, "plugins/mitori/skills/review/SKILL.md"), "utf8");
    expect(Buffer.byteLength(skill)).toBeLessThanOrEqual(1500);
    expect(skill).toContain("disable-model-invocation: true");
    // the hook embeds mitori's own path (SEC-21) and prints nothing
    expect(readFileSync(join(root, "plugins/mitori/hooks/hooks.json"), "utf8")).toContain(`${BIN} touch --stdin --source claude-hook`);
    expect(existsSync(join(root, "plugins/mitori/.mcp.json"))).toBe(false);
    const rec = join(int.home, "integrations.json");
    expect(statSync(rec).mode & 0o777).toBe(0o600);
    const v = viewOf(await views(), "claude-code", "user");
    expect(v?.files.every((f) => f.state === "current")).toBe(true);
    // the shipped tree in the repository is what was installed (the same bytes `claude plugin validate` checks)
    expect(skill).toBe(readFileSync(join(import.meta.dir, "../../integrations/claude-code/plugins/mitori/skills/review/SKILL.md"), "utf8"));
  });

  test("--mcp adds the plugin's .mcp.json (opt-in) and the view says mcp: true", async () => {
    const r = await cli(["claude-code", "--mcp"]);
    expect(r.code).toBe(0);
    const mcp = join(userHome, ".mitori/integrations/claude-code/plugins/mitori/.mcp.json");
    expect(JSON.parse(readFileSync(mcp, "utf8"))).toEqual({ mcpServers: { mitori: { command: BIN, args: ["mcp"] } } });
    const v = viewOf(await views(), "claude-code", "user");
    expect(v?.mcp).toBe(true);
    expect(v?.files.some((f) => f.path === mcp && f.state === "current")).toBe(true);
  });

  test("agents-md (project): the block alone in a new AGENTS.md, ≤ 80 tokens; a hand edit is kept; --force asks on a TTY", async () => {
    const r = await cli(["agents-md"]);
    expect(r.code).toBe(0);
    const path = join(repo.root, "AGENTS.md");
    const text = readFileSync(path, "utf8");
    expect(text.startsWith("<!-- BEGIN:mitori -->\nmitori: design doc at `.mitori/README.md`")).toBe(true);
    expect(text.trimEnd().endsWith("<!-- END:mitori -->")).toBe(true);
    expect(estimateTokensRaw(text.trimEnd(), "markdown_en", "claude-v5")).toBeLessThanOrEqual(80);
    expect(viewOf(await views(`?ws=${ws}`), "agents-md", "project")?.files).toEqual([{ path: join(repo.root, "AGENTS.md"), state: "current" }]);

    // the user's own text around the block is never touched; an edit INSIDE the block is theirs now
    writeFileSync(path, `# Team rules\n\nUse tabs.\n\n${text.replace("may lag code", "is gospel")}`);
    expect(viewOf(await views(`?ws=${ws}`), "agents-md", "project")?.files[0]?.state).toBe("modified");
    const again = await cli(["agents-md"]);
    expect(again.code).toBe(0);
    expect(again.err).toContain("--force");
    expect(readFileSync(path, "utf8")).toContain("is gospel");
    // --force: refused without a TTY (agents), confirmed on one
    expect((await cli(["agents-md", "--force"])).code).toBe(2);
    const forced = await cli(["agents-md", "--force"], { tty: true, answer: true });
    expect(forced.code).toBe(0);
    const after = readFileSync(path, "utf8");
    expect(after).toContain("may lag code");
    expect(after.startsWith("# Team rules\n\nUse tabs.\n\n")).toBe(true);
    expect(viewOf(await views(`?ws=${ws}`), "agents-md", "project")?.files[0]?.state).toBe("current");
  });

  test("claude-code (project): the project skill under .claude/skills; validation errors are 400; unknown ws is 404", async () => {
    const res = await int.json<IntegrationStatusView>("POST", "/integrations/claude-code/install", { scope: "project", ws, mcp: false, force: false });
    expect(res.files).toEqual([{ path: join(repo.root, ".claude/skills/mitori-review/SKILL.md"), state: "current" }]);
    const skill = readFileSync(join(repo.root, ".claude/skills/mitori-review/SKILL.md"), "utf8");
    expect(skill).toContain("name: mitori-review\n");
    expect(Buffer.byteLength(skill)).toBeLessThanOrEqual(1500);
    expect((await int.cli("POST", "/integrations/agents-md/install", { scope: "user", mcp: false, force: false })).status).toBe(400);
    expect((await int.cli("POST", "/integrations/cursor/install", { scope: "user", mcp: false, force: false })).status).toBe(400);
    expect((await int.cli("POST", "/integrations/codex/install", { scope: "project", mcp: false, force: false })).status).toBe(400);
    expect((await int.cli("POST", "/integrations/codex/install", { scope: "project", ws: "ws_aaaaaaaaaaaa", mcp: false, force: false })).status).toBe(404);
  });

  test("POST /ws/:ws/init {agentsBlock: true} writes the same block (idempotent: the file is unchanged when current)", async () => {
    const before = readFileSync(join(repo.root, "AGENTS.md"), "utf8");
    await int.json("POST", `/ws/${ws}/init`, { lang: "ja", commit: false, agentsBlock: true });
    expect(readFileSync(join(repo.root, "AGENTS.md"), "utf8")).toBe(before);
  });
});
