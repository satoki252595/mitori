import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSafeWriter } from "@mitori/platform";
import { type AssetTable, assetTable } from "./assets.ts";
import { materializeWindowsJob } from "./windows-job.ts";

test("native launcher extraction binds exact bytes and refuses corrupted bytes and symlink cache paths", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "mitori-native-")));
  try {
    const bytes = new TextEncoder().encode("verified test bytes");
    const source = join(home, "source.exe");
    writeFileSync(source, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const t: AssetTable = { ...assetTable(), windowsJobLauncher: { path: source, sha256, bytes: bytes.length } };
    const writer = createSafeWriter();
    const pinned = await materializeWindowsJob(home, writer, t);
    expect(await Bun.file(pinned.path).bytes()).toEqual(bytes);
    const ino = lstatSync(pinned.path).ino;
    await materializeWindowsJob(home, writer, t);
    expect(lstatSync(pinned.path).ino).toBe(ino);
    writeFileSync(source, "corrupted");
    await expect(materializeWindowsJob(home, writer, t)).rejects.toThrow("integrity");
    writeFileSync(source, bytes);
    rmSync(join(home, "cache"), { recursive: true });
    symlinkSync(home, join(home, "cache"), "junction");
    await expect(materializeWindowsJob(home, writer, t)).rejects.toThrow("symlink");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
