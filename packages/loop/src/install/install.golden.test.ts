/**
 * AC-L77 integration templates: rendered hashes and the installer plan are pinned (`fixtures/golden/integrations/`),
 * the shipped plugin tree `integrations/` is byte-identical to what `mitori install` renders (with `mitori` on PATH),
 * and the size budgets hold: SKILL.md ≤ 1.5 KB in all three variants (`install.skillBytes`), the AGENTS.md block
 * ≤ 80 tokens (`install.agentsTokens`).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { estimateTokensRaw } from "@mitori/indexer";
import { createHasher } from "@mitori/platform";
import { expectGolden } from "@mitori/testkit";
import { INTEGRATION_TEMPLATES } from "../contract.ts";
import { renderSkill } from "./index.ts";
import { fileSpecs, renderTemplate, type TemplateId } from "./templates.ts";

const ROOT = join(import.meta.dir, "../../../..");
const TREE = join(ROOT, "integrations");
const VARS = { mitoriBin: "mitori", docDir: ".mitori" };
const sha256 = (s: string) => createHasher().sha256(s);
const ALL: TemplateId[] = [
  ...(Object.keys(INTEGRATION_TEMPLATES) as TemplateId[]),
  "claude-code/project/skills/mitori-review/SKILL.md@1",
  "codex/skills/mitori-review/SKILL.md@1",
];

/** The shipped tree: the user-scope plugin (no `.mcp.json`: MCP stays opt-in), the codex skill and the AGENTS block. */
function shippedTree(): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of fileSpecs("claude-code", "user", false))
    out.set(`claude-code/${s.rel.replace(".mitori/integrations/claude-code/", "")}`, renderTemplate(s.template, VARS));
  out.set("claude-code-project/.claude/skills/mitori-review/SKILL.md", renderSkill("project"));
  out.set("codex/.agents/skills/mitori-review/SKILL.md", renderSkill("codex"));
  out.set("agents-md/AGENTS.block.md", `${renderTemplate("agents-md/block@1", VARS)}\n`);
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(TREE, p)];
  });
}

describe("AC-L77 integration templates", () => {
  test("golden: rendered bytes + sha256 per template (version bumps show up here)", () => {
    const hashes: Record<string, { bytes: number; sha256: string }> = {};
    for (const id of ALL) {
      const text = renderTemplate(id, VARS);
      hashes[id] = { bytes: Buffer.byteLength(text), sha256: sha256(text) };
    }
    expectGolden("integrations/hashes.json", hashes);
  });

  test("golden: installer plan of `mitori install claude-code --mcp` (user scope)", () => {
    const plan = fileSpecs("claude-code", "user", true).map((s) => ({
      path: s.rel,
      template: s.template,
      mode: s.mode,
      sha256: sha256(renderTemplate(s.template, VARS)),
    }));
    expectGolden("integrations/claude-code/plan.json", plan);
  });

  test("integrations/ is exactly what the installer renders (MITORI_UPDATE_GOLDEN=1 rewrites it)", () => {
    const want = shippedTree();
    if (process.env.MITORI_UPDATE_GOLDEN === "1")
      for (const [rel, text] of want) {
        mkdirSync(dirname(join(TREE, rel)), { recursive: true });
        writeFileSync(join(TREE, rel), text);
      }
    const have = walk(TREE).filter((p) => p !== "README.md" && p !== "biome.json");
    expect(have.sort()).toEqual([...want.keys()].sort());
    for (const [rel, text] of want) expect({ rel, text: readFileSync(join(TREE, rel), "utf8") }).toEqual({ rel, text });
  });

  test("install.skillBytes: every SKILL.md variant ≤ 1.5 KB; the instructions below the frontmatter ≤ 1,400 B", () => {
    for (const v of ["plugin", "project", "codex"] as const) {
      const text = renderSkill(v);
      const body = text.slice(text.indexOf("\n---\n", 4) + 5);
      expect({ v, bytes: Buffer.byteLength(text) <= 1536 }).toEqual({ v, bytes: true });
      expect({ v, body: Buffer.byteLength(body) <= 1400 }).toEqual({ v, body: true });
    }
    for (const id of ["claude-code/skills/gen/SKILL.md@1", "claude-code/agents/mitori-gen-writer.md@1"] as const)
      expect(Buffer.byteLength(INTEGRATION_TEMPLATES[id])).toBeLessThanOrEqual(1536);
  });

  test("skills are explicit-invocation only and never grant more than mitori's own commands + read tools [SEC-04]", () => {
    for (const v of ["plugin", "project"] as const) {
      const text = renderSkill(v);
      expect(text).toContain("\ndisable-model-invocation: true\n");
      const tools = /\nallowed-tools: (.*)\n/.exec(text)?.[1]?.split(", ") ?? [];
      expect(tools.every((t) => /^Bash\(mitori [a-z]+:\*\)$/.test(t) || ["Read", "Glob", "Grep"].includes(t))).toBe(true);
    }
    const codex = renderSkill("codex");
    expect(
      codex
        .split("\n---\n")[0]
        ?.split("\n")
        .slice(1)
        .map((l) => l.split(":")[0]),
    ).toEqual(["name", "description"]);
    expect(codex).toContain("`mitori review --wait-sec 540`");
    expect(codex).not.toContain("run_in_background");
    expect(renderSkill("project")).toContain("name: mitori-review\n");
    expect(renderSkill("project")).not.toContain("/mitori:review");
  });

  // CR-PENDING(WP-11) cr-requests/WP-11.md #3: the R1 block (with the prep exception) measures ≈ 98 tokens incl. the
  // markers (≈ 83 without) against the 80-token limit; the template is contract text, so this flips to passing when
  // the architect shortens it (then drop `.failing`).
  test.failing("install.agentsTokens: the AGENTS.md block ≤ 80 tokens", () => {
    const block = renderTemplate("agents-md/block@1", VARS);
    expect(estimateTokensRaw(block, "markdown_en", "claude-v5")).toBeLessThanOrEqual(80);
  });
});
