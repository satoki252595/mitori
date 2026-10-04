/** F1 (nonfunc audit): agent mode never shows the model a tracked secret, and the user's file keeps it. */
import { describe, expect, test } from "bun:test";
import { createSecretScanner, type GitOid, type RepoPath } from "@mitori/core";
import { type HideDeps, hiddenToken, hideSecrets, hideText, revealText } from "./secrets.ts";

const secrets = createSecretScanner();
const KEY = `sk_live_${"4eC39HqLyjWDarjtT1zdp7dc"}`;
const AWS = `ghp_${"R4nd0mT0kenV4lue1234567890abcdefXYZW"}`;
const enc = new TextEncoder();

function fakeTree(files: Record<string, string>) {
  const disk = new Map<string, string>(Object.entries(files));
  const blobs = new Map<string, Uint8Array>(Object.entries(files).map(([p, t]) => [`oid:${p}`, enc.encode(t)]));
  const writes: Record<string, string>[] = [];
  const d: HideDeps = {
    secrets,
    tree: async () => Object.keys(files).map((p) => ({ path: p as RepoPath, oid: `oid:${p}` as GitOid, mode: "100644" })),
    blob: async (oid) => blobs.get(oid) as Uint8Array,
    read: async (p) => disk.get(p) ?? null,
    write: async (f) => {
      writes.push(f);
      for (const [p, t] of Object.entries(f)) disk.set(p, t);
    },
    cache: new Map(),
  };
  return { d, disk, writes };
}

describe("F1 agent-mode secret hiding", () => {
  test("hideText numbers each hit; revealText puts back the ones the edit kept", () => {
    const text = `const a = "${KEY}";\nconst b = "${AWS}";\n`;
    const h = hideText(text, secrets);
    expect(h?.secrets).toEqual([KEY, AWS]);
    expect(h?.hidden).toBe(`const a = "${hiddenToken(1)}";\nconst b = "${hiddenToken(2)}";\n`);
    expect(h?.hidden).not.toContain("sk_live_");
    expect(revealText(h?.hidden as string, h?.secrets ?? [])).toBe(text);
    // the edit removed the first key (moved to an env var): only the second comes back
    const edited = `const a = process.env.STRIPE_KEY;\nconst b = "${hiddenToken(2)}";\n`;
    expect(revealText(edited, h?.secrets ?? [])).toBe(`const a = process.env.STRIPE_KEY;\nconst b = "${AWS}";\n`);
    expect(() => revealText(`x = "${hiddenToken(9)}"`, h?.secrets ?? [])).toThrow(/redaction token/);
  });

  test("during the turn the worktree holds tokens only; after it, the files outside the scope are byte-identical", async () => {
    const settings = `export const stripe = "${KEY}";\n`;
    const { d, disk } = fakeTree({ "config/settings.js": settings, "src/app.ts": "export const x = 1;\n" });
    const h = await hideSecrets(d, ["src/app.ts" as RepoPath]);
    expect(h.files).toEqual(["config/settings.js"]);
    expect(disk.get("config/settings.js")).not.toContain("sk_live_");
    expect([...disk.values()].join("")).not.toContain(KEY);
    // the agent edits its own file
    disk.set("src/app.ts", "export const x = 2;\n");
    await h.reveal();
    expect(disk.get("config/settings.js")).toBe(settings);
    expect(disk.get("src/app.ts")).toBe("export const x = 2;\n");
  });

  test("a file in the write scope: the edit works on the hidden text and the kept secret returns", async () => {
    const cfg = `export const key = "${KEY}";\nexport const retries = 1;\n`;
    const { d, disk } = fakeTree({ "src/config.ts": cfg });
    const h = await hideSecrets(d, ["src/config.ts" as RepoPath]);
    const seen = disk.get("src/config.ts") as string;
    expect(seen).toBe(`export const key = "${hiddenToken(1)}";\nexport const retries = 1;\n`);
    disk.set("src/config.ts", seen.replace("retries = 1", "retries = 3"));
    await h.reveal();
    expect(disk.get("src/config.ts")).toBe(`export const key = "${KEY}";\nexport const retries = 3;\n`);
  });

  test("no secrets: nothing is written; a second job reuses the per-blob scan", async () => {
    const { d, writes } = fakeTree({ "a.ts": "export const a = 1;\n" });
    const h = await hideSecrets(d, []);
    expect(h.files).toEqual([]);
    await h.reveal();
    expect(writes).toEqual([]);
    expect(d.cache.size).toBe(1);
  });
});
