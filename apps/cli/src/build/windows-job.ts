import { createHash } from "node:crypto";
import { join } from "node:path";
import { MitoriError, type SafeWriter } from "@mitori/core";
import { type AssetTable, assetTable } from "./assets.ts";

/** The binary contains no secrets; SafeWriter checks every directory and refuses symlink targets. */
export async function materializeWindowsJob(home: string, writer: SafeWriter, t: AssetTable = assetTable()): Promise<{ path: string; sha256: string }> {
  const entry = t.windowsJobLauncher;
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256))
    throw new MitoriError("E_UNSUPPORTED", "Windows process-tree launcher is missing; rebuild the Windows binary");
  const bytes = await Bun.file(entry.path).bytes();
  if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new MitoriError("E_PRECONDITION", "Windows process-tree launcher failed its embedded integrity check");
  const rel = `cache/native/windows-job-${entry.sha256}.exe`;
  // This public binary uses the unchanged-byte path, avoiding replacement of an EXE mapped by another daemon.
  await writer.write(home, rel, bytes, "accept");
  return { path: join(home, rel), sha256: entry.sha256 };
}
