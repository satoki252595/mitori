import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetsReady, sourceFingerprint } from "./start.ts";

test("startup refreshes changed/deleted source and missing output, and reuses intact production assets", () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-start-"));
  try {
    writeFileSync(join(root, "source.ts"), "one");
    const fingerprint = sourceFingerprint(root, ["source.ts"]);
    expect(assetsReady(root, fingerprint)).toBe(false);
    mkdirSync(join(root, "dist/.build/initial"), { recursive: true });
    writeFileSync(join(root, "dist/.build/start.sha256"), fingerprint);
    writeFileSync(join(root, "dist/.build/initial/initial.js"), "export {};");
    writeFileSync(join(root, "dist/.build/index.html"), "<!doctype html>");
    writeFileSync(join(root, "dist/.build/web.json"), JSON.stringify({ "/index.html": { raw: "dist/.build/index.html" } }));
    expect(assetsReady(root, fingerprint)).toBe(true);
    writeFileSync(join(root, "source.ts"), "two");
    expect(sourceFingerprint(root, ["source.ts"])).not.toBe(fingerprint);
    expect(assetsReady(root, sourceFingerprint(root, ["source.ts"]))).toBe(false);
    expect(sourceFingerprint(root, [])).not.toBe(fingerprint);
    expect(sourceFingerprint(root, ["source.ts"], "different runtime")).not.toBe(sourceFingerprint(root, ["source.ts"]));
    rmSync(join(root, "dist/.build/index.html"));
    expect(assetsReady(root, fingerprint)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the ordinary Bun start command accepts --version without building assets or calling an LLM", () => {
  const proc = Bun.spawnSync([process.execPath, "run", "start", "--", "--version"], { stdout: "pipe", stderr: "pipe" });
  expect(proc.exitCode).toBe(0);
  expect(new TextDecoder().decode(proc.stdout)).toBe("mitori 0.0.0 (api 1)\n");
});
