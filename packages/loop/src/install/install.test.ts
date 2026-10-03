/**
 * `mitori install` (spec §11): plan per target × scope, create-only writes, `--force`, the AGENTS.md / CLAUDE.md
 * managed block, `~/.mitori/integrations.json` records and the freshness states of §11.4 (AC-L78).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@mitori/core";
import { createHasher, createSafeWriter } from "@mitori/platform";
import { AGENTS_BLOCK_MARKERS, type Installer } from "../contract.ts";
import { createInstaller, renderSkill } from "./index.ts";

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
const BIN = "/opt/mitori/bin/mitori";

let dir = "";
let userHome = "";
let home = "";
let repo = "";
let installer: Installer;

function make(mitoriBin = BIN): Installer {
  return createInstaller({ safeWrite: createSafeWriter(), hasher: createHasher(), home, userHome, mitoriBin, stateWrite: async (_l, fn) => fn(), log });
}
const project = () => ({ root: repo, docDir: ".mitori" });
const opts = (o: Record<string, unknown>) => o as { mcp: boolean; force: boolean };
const read = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "mitori-install-")));
  userHome = join(dir, "user");
  home = join(userHome, ".mitori");
  repo = join(dir, "repo");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(repo);
  installer = make();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("plan", () => {
  test("claude-code user: the local marketplace + plugin; .mcp.json only with --mcp", () => {
    const paths = installer.plan("claude-code", "user", { mcp: false }).map((f) => f.path);
    expect(paths).toEqual([
      ".mitori/integrations/claude-code/.claude-plugin/marketplace.json",
      ".mitori/integrations/claude-code/plugins/mitori/.claude-plugin/plugin.json",
      ".mitori/integrations/claude-code/plugins/mitori/skills/review/SKILL.md",
      ".mitori/integrations/claude-code/plugins/mitori/skills/gen/SKILL.md",
      ".mitori/integrations/claude-code/plugins/mitori/agents/mitori-gen-writer.md",
      ".mitori/integrations/claude-code/plugins/mitori/hooks/hooks.json",
    ]);
    const withMcp = installer.plan("claude-code", "user", { mcp: true });
    expect(withMcp.at(-1)?.path).toBe(".mitori/integrations/claude-code/plugins/mitori/.mcp.json");
    expect(withMcp.at(-1)?.content).toBe(`{"mcpServers":{"mitori":{"command":"${BIN}","args":["mcp"]}}}\n`);
  });

  test("the hook embeds the install-time realpath, shell-quoted when needed [SEC-21]", () => {
    const hook = (bin: string) =>
      make(bin)
        .plan("claude-code", "user", { mcp: false })
        .find((f) => f.path.endsWith("hooks.json"))?.content ?? "";
    expect(JSON.parse(hook(BIN)).hooks.PostToolUse[0].hooks[0].command).toBe(`${BIN} touch --stdin --source claude-hook 2>/dev/null || true`);
    const odd = "/Users/o'neil/My Apps/mitori";
    expect(JSON.parse(hook(odd)).hooks.PostToolUse[0].hooks[0].command).toBe(
      `'/Users/o'\\''neil/My Apps/mitori' touch --stdin --source claude-hook 2>/dev/null || true`,
    );
  });

  test("project scopes write the skill only; codex has its own variant; agents-md needs a project", () => {
    expect(installer.plan("claude-code", "project", opts({ mcp: false, project: project() })).map((f) => [f.path, f.content])).toEqual([
      [".claude/skills/mitori-review/SKILL.md", renderSkill("project")],
    ]);
    expect(installer.plan("codex", "user", { mcp: false }).map((f) => [f.path, f.content])).toEqual([
      [".agents/skills/mitori-review/SKILL.md", renderSkill("codex")],
    ]);
    expect(() => installer.plan("agents-md", "user", { mcp: false })).toThrow(/project integration/);
    expect(() => installer.plan("agents-md", "project", { mcp: false })).toThrow(/workspace root/);
    expect(() => installer.plan("cursor", "user", { mcp: false })).toThrow(/not available/);
  });

  test("the managed block hash covers the text between the markers only", () => {
    const [f] = installer.plan("agents-md", "project", opts({ mcp: false, project: project() }));
    expect(f?.mode).toBe("managed-block");
    expect(f?.content.startsWith(AGENTS_BLOCK_MARKERS.begin)).toBe(true);
    const inner = f?.content.split("\n").slice(1, -1).join("\n") ?? "";
    expect(f?.hash).toBe(createHasher().sha256(inner));
    expect(inner).toContain("`.mitori/README.md`");
  });

  test("a shadow workspace (docDir outside the tree) gets no AGENTS.md block", () => {
    expect(() => installer.plan("agents-md", "project", opts({ mcp: false, project: { root: repo, docDir: "/elsewhere/doc" } }))).toThrow(
      /outside the repository/,
    );
  });
});

describe("install", () => {
  test("first install writes every file, records them 0600 and prints the marketplace commands", async () => {
    const r = await installer.install("claude-code", "user", { mcp: true, force: false });
    expect(r.written.length).toBe(7);
    expect(r.skipped).toEqual([]);
    expect(r.nextCommands).toEqual(["claude plugin marketplace add ~/.mitori/integrations/claude-code", "claude plugin install mitori@mitori-local"]);
    for (const f of installer.plan("claude-code", "user", { mcp: true })) expect(read(join(userHome, f.path))).toBe(f.content);
    const recPath = join(home, "integrations.json");
    expect(statSync(recPath).mode & 0o777).toBe(0o600);
    const rec = JSON.parse(read(recPath)) as { files: { path: string; template: string; sha256: string; target: string; scope: string }[] };
    expect(rec.files.length).toBe(7);
    expect(rec.files[0]).toMatchObject({ target: "claude-code", scope: "user", template: "claude-code/.claude-plugin/marketplace.json@1" });
    expect(rec.files.every((f) => f.path.startsWith(`${userHome}/`))).toBe(true);
    expect((await installer.status()).every((s) => s.state === "current")).toBe(true);
  });

  test("idempotent: a second install writes nothing; after a template-equivalent update the update commands show", async () => {
    await installer.install("claude-code", "user", { mcp: false, force: false });
    const again = await installer.install("claude-code", "user", { mcp: false, force: false });
    expect(again).toEqual({ written: [], skipped: [], nextCommands: [] });
    // the binary moved: the hook is outdated (still what mitori wrote) and is rewritten without --force
    const moved = make("/usr/local/bin/mitori");
    expect((await moved.status()).find((s) => s.file.path.endsWith("hooks.json"))?.state).toBe("outdated");
    const r = await moved.install("claude-code", "user", { mcp: false, force: false });
    expect(r.written.map((p) => p.split("/").pop())).toEqual(["hooks.json"]);
    expect(r.nextCommands).toEqual(["claude plugin marketplace update mitori-local", "claude plugin update mitori@mitori-local"]);
  });

  test("AC-L78 a file the user edited is modified: kept without --force, overwritten with it", async () => {
    await installer.install("claude-code", "user", { mcp: false, force: false });
    const skill = join(userHome, ".mitori/integrations/claude-code/plugins/mitori/skills/review/SKILL.md");
    writeFileSync(skill, "# my own skill\n");
    expect((await installer.status()).find((s) => s.file.path.endsWith("review/SKILL.md"))?.state).toBe("modified");
    const kept = await installer.install("claude-code", "user", { mcp: false, force: false });
    expect(kept.written).toEqual([]);
    expect(kept.skipped).toEqual([skill]);
    expect(read(skill)).toBe("# my own skill\n");
    const forced = await installer.install("claude-code", "user", { mcp: false, force: true });
    expect(forced.written).toEqual([skill]);
    expect(read(skill)).toBe(renderSkill("plugin"));
  });

  test("a pre-existing file mitori never wrote is not overwritten (unless --force); an identical one is adopted", async () => {
    const rel = ".claude/skills/mitori-review/SKILL.md";
    mkdirSync(join(repo, ".claude/skills/mitori-review"), { recursive: true });
    writeFileSync(join(repo, rel), "theirs\n");
    const o = opts({ mcp: false, force: false, project: project() });
    expect((await installer.install("claude-code", "project", o)).skipped).toEqual([join(repo, rel)]);
    writeFileSync(join(repo, rel), renderSkill("project"));
    const adopted = await installer.install("claude-code", "project", o);
    expect(adopted.written).toEqual([]);
    expect((await installer.status()).map((s) => [s.file.path, s.state])).toEqual([[rel, "current"]]);
  });

  test("AC-L78 missing: a deleted file is reported and re-created by the next install", async () => {
    await installer.install("codex", "user", { mcp: false, force: false });
    const p = join(userHome, ".agents/skills/mitori-review/SKILL.md");
    rmSync(p);
    expect((await installer.status()).map((s) => s.state)).toEqual(["missing"]);
    expect((await installer.install("codex", "user", { mcp: false, force: false })).written).toEqual([p]);
  });

  test("codex --mcp prints the registration command instead of running it", async () => {
    const r = await installer.install("codex", "user", { mcp: true, force: false });
    expect(r.nextCommands).toEqual([`codex mcp add mitori -- ${BIN} mcp`]);
  });
});

describe("AGENTS.md / CLAUDE.md managed block (spec §11.3)", () => {
  const o = () => opts({ mcp: false, force: false, project: project() });
  const block = () => installer.plan("agents-md", "project", o())[0]?.content ?? "";

  test("creates AGENTS.md; appends after one blank line; replaces between the markers only", async () => {
    await installer.install("agents-md", "project", o());
    expect(read(join(repo, "AGENTS.md"))).toBe(`${block()}\n`);
    writeFileSync(join(repo, "AGENTS.md"), "# Agents\n\nBe nice.\n\n\n");
    await installer.install("agents-md", "project", o());
    expect(read(join(repo, "AGENTS.md"))).toBe(`# Agents\n\nBe nice.\n\n${block()}\n`);
    // mitori's own update of the block (e.g. another docDir) touches nothing outside the markers
    writeFileSync(join(repo, "AGENTS.md"), `# A\n${block()}\ntail\n`);
    await installer.install("agents-md", "project", opts({ mcp: false, force: false, project: { root: repo, docDir: "docs/mitori" } }));
    const text = read(join(repo, "AGENTS.md"));
    expect(text.startsWith("# A\n<!-- BEGIN:mitori -->\n")).toBe(true);
    expect(text.endsWith("<!-- END:mitori -->\ntail\n")).toBe(true);
    expect(text).toContain("`docs/mitori/README.md`");
  });

  test("an edited block is modified (kept); two marker pairs are E_CONFLICT", async () => {
    await installer.install("agents-md", "project", o());
    const p = join(repo, "AGENTS.md");
    writeFileSync(p, read(p).replace("may lag code", "is gospel"));
    expect((await installer.status())[0]?.state).toBe("modified");
    expect((await installer.install("agents-md", "project", o())).skipped).toEqual([p]);
    writeFileSync(p, `${block()}\n${block()}\n`);
    await expect(installer.install("agents-md", "project", o())).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  test("CLAUDE.md gets the block unless it is a symlink to AGENTS.md or includes @AGENTS.md", async () => {
    writeFileSync(join(repo, "CLAUDE.md"), "# Claude\n");
    let r = await installer.install("agents-md", "project", o());
    expect(r.written).toEqual([join(repo, "AGENTS.md"), join(repo, "CLAUDE.md")]);
    expect(read(join(repo, "CLAUDE.md"))).toBe(`# Claude\n\n${block()}\n`);

    rmSync(join(repo, "CLAUDE.md"));
    writeFileSync(join(repo, "CLAUDE.md"), "See @AGENTS.md\n");
    r = await installer.install("agents-md", "project", o());
    expect(read(join(repo, "CLAUDE.md"))).toBe("See @AGENTS.md\n");

    rmSync(join(repo, "CLAUDE.md"));
    symlinkSync("AGENTS.md", join(repo, "CLAUDE.md"));
    expect(installer.plan("agents-md", "project", o()).map((f) => f.path)).toEqual(["AGENTS.md"]);
    await installer.install("agents-md", "project", o());
    expect(lstatSync(join(repo, "CLAUDE.md")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(repo, "AGENTS.md"))).toBe(true);
  });
});
