import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "mitori-uncited-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("EX-04 counts only sidecar-owned AI prose, preserving citations and explicitly labelling legacy scope", () => {
  const docDir = join(root, "doc");
  mkdirSync(join(docDir, "modules"), { recursive: true });
  writeFileSync(
    join(docDir, "modules/sample.md"),
    [
      "# Module <!-- b_aaaaaaaa -->",
      "Static `Helper` advice has no citation. <!-- b_bbbbbbbb -->",
      "Human `Helper` prose also has no citation. <!-- b_cccccccc -->",
      "AI `Worker` prose has no citation. AI returns the result ([worker.ts:1](../../../worker.ts#L1)). <!-- b_dddddddd -->",
      "> [!NOTE]\n> **この章で分かること**\n> This learning objective is not a factual claim. <!-- b_eeeeeeee -->",
      "```md\nFake `Tool` sentence must not become AI prose. <!-- b_ffffffff -->\n```\n<!-- b_gggggggg -->",
      "Wrong-file `Helper` prose has no citation. <!-- b_hhhhhhhh -->",
      "Untracked `Helper` prose has no citation. <!-- b_kkkkkkkk -->",
      "Untracked `Helper` prose has no citation.",
    ].join("\n\n"),
  );
  writeFileSync(join(docDir, "00-tldr.md"), "AI overview has no citation. <!-- b_jjjjjjjj -->\n");
  const meta = (origin: string, kind = "prose", file = "doc/modules/sample.md") => ({ origin, kind, file, lang: "ja" });
  const indexPath = join(root, "doc.index.json");
  writeFileSync(
    indexPath,
    JSON.stringify({
      kind: "mitori/doc-index",
      schemaVersion: 1,
      blocks: {
        b_aaaaaaaa: meta("static", "heading"),
        b_bbbbbbbb: meta("static"),
        b_cccccccc: meta("human"),
        b_dddddddd: meta("ai"),
        b_eeeeeeee: meta("ai", "learn"),
        b_ffffffff: meta("ai"),
        b_gggggggg: meta("static", "code"),
        b_hhhhhhhh: meta("ai", "prose", "doc/other.md"),
        b_jjjjjjjj: meta("ai", "prose", "doc/00-tldr.md"),
      },
    }),
  );
  const run = (...args: string[]) => {
    const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "doc-uncited.ts"), docDir, ...args]);
    expect(child.exitCode).toBe(0);
    return child.stdout.toString();
  };
  const indexed = run("--list");
  expect(indexed).toContain("scope: AI-origin blocks from adjacent doc.index.json; modules only");
  expect(indexed).toContain("total: 2 sentences · uncited 1 (50.0 %) · uncited naming code 1 (50.0 %)");
  expect(indexed).toContain("AI Worker prose has no citation");
  expect(indexed).not.toMatch(/Static|Human|Untracked|Fake|Wrong-file|learning objective|AI overview/);
  expect(run("--all")).toContain("total: 3 sentences · uncited 2 (66.7 %) · uncited naming code 1 (33.3 %)");
  rmSync(indexPath);
  expect(run()).toContain("scope: legacy mixed-origin Markdown (no doc.index.json; not AI-only quality); modules only");
  writeFileSync(indexPath, "null");
  const invalid = Bun.spawnSync([process.execPath, join(import.meta.dir, "doc-uncited.ts"), docDir]);
  expect(invalid.exitCode).not.toBe(0);
  expect(invalid.stdout.toString()).not.toContain("legacy mixed-origin");
});
