import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { type AssetTable, assetTable, GRAMMAR_LANGS, loadWebAssets, pinnedScriptUrl, readPinned } from "./assets.ts";

describe("SKEL-U-05 asset table (source checkout)", () => {
  test("every lock entry and Worker resolves to an existing file", () => {
    const t = assetTable();
    expect(t.source).toBe("dev");
    expect(t.lock.map((a) => a.id)).toEqual(
      expect.arrayContaining(["treesitter.runtime", "elk.worker", "shiki.onig", ...GRAMMAR_LANGS.map((l) => `grammar.${l}`)]),
    );
    for (const a of t.lock) expect({ id: a.id, exists: existsSync(t.files[a.id] ?? "") }).toEqual({ id: a.id, exists: true });
    for (const w of Object.values(t.workers)) expect(existsSync(new URL(w).pathname)).toBe(true);
  });

  test("web assets always include an index (placeholder before the first build)", async () => {
    const web = await loadWebAssets({ ...assetTable(), web: {} });
    expect(new TextDecoder().decode(web.get("/index.html")?.raw)).toContain("mitori");
  });
});

describe("SKEL-U-06 packed pinned files", () => {
  test("readPinned unpacks .br; pinnedScriptUrl hands out a Blob URL for packed scripts only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mitori-assets-"));
    try {
      const raw = new TextEncoder().encode("self.onmessage = () => {};\n".repeat(50));
      writeFileSync(join(dir, "w.js.br"), brotliCompressSync(raw));
      writeFileSync(join(dir, "w.js"), raw);
      const t: AssetTable = {
        source: "embedded",
        lock: [],
        web: {},
        workers: { parse: "", compute: "" },
        files: { packed: join(dir, "w.js.br"), plain: join(dir, "w.js") },
      };
      expect(await readPinned("packed", t)).toEqual(raw);
      expect(await readPinned("plain", t)).toEqual(raw);
      expect(await pinnedScriptUrl("plain", t)).toBe(join(dir, "w.js"));
      const url = await pinnedScriptUrl("packed", t);
      expect(url.startsWith("blob:")).toBe(true);
      URL.revokeObjectURL(url);
      await expect(readPinned("absent", t)).rejects.toThrow("not embedded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
