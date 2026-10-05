// Nix only: nix develop .#windowsCross -c bun scripts/build-windows-job.ts
// Generated executable/record stay ignored. gen-assets verifies and embeds the record's exact bytes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.ts";

export const WINDOWS_JOB_SOURCE = "packages/platform/native/windows-job.c";
export const WINDOWS_JOB_BUILD = "scripts/build-windows-job.ts";
export const WINDOWS_JOB_DIR = "node_modules/.cache/mitori-windows-job";
export const WINDOWS_JOB_PATH = `${WINDOWS_JOB_DIR}/windows-job-x64.exe`;
export const WINDOWS_JOB_RECORD = `${WINDOWS_JOB_DIR}/windows-job-x64.json`;
export const windowsJobHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface WindowsJobRecord {
  v: "mitori.windows-job/1";
  platform: "windows-x64";
  path: string;
  sha256: string;
  bytes: number;
  sourceSha256: string;
  buildSha256: string;
  compiler: { name: "zig"; version: string };
}

/** Pin the source/build and emitted AMD64 PE; never silently reuse a stale or modified helper. */
export function verifyWindowsJob(record: WindowsJobRecord, read: (path: string) => Uint8Array): string[] {
  const problems: string[] = [];
  if (record.v !== "mitori.windows-job/1" || record.platform !== "windows-x64" || record.path !== WINDOWS_JOB_PATH) return ["invalid Windows job record"];
  for (const [path, expected] of [
    [WINDOWS_JOB_SOURCE, record.sourceSha256],
    [WINDOWS_JOB_BUILD, record.buildSha256],
  ] as const)
    if (windowsJobHash(read(path)) !== expected) problems.push(`${path}: source changed; rebuild the helper`);
  const exe = read(record.path);
  if (exe.length !== record.bytes || windowsJobHash(exe) !== record.sha256) problems.push("Windows job executable bytes/hash changed");
  const pe = exe.length >= 64 ? new DataView(exe.buffer, exe.byteOffset, exe.byteLength).getUint32(60, true) : exe.length;
  if (
    exe[0] !== 0x4d ||
    exe[1] !== 0x5a ||
    pe > exe.length - 6 ||
    exe[pe] !== 0x50 ||
    exe[pe + 1] !== 0x45 ||
    exe[pe + 2] !== 0 ||
    exe[pe + 3] !== 0 ||
    exe[pe + 4] !== 0x64 ||
    exe[pe + 5] !== 0x86
  )
    problems.push("Windows job must be an AMD64 PE executable");
  if (record.compiler.name !== "zig" || !/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(record.compiler.version)) problems.push("invalid compiler record");
  return problems;
}

export function buildWindowsJob(): WindowsJobRecord {
  const version = Bun.spawnSync(["zig", "version"], { stdout: "pipe", stderr: "pipe" });
  if (version.exitCode !== 0) throw new Error("Windows helper requires the repository Nix windowsCross shell (Zig)");
  mkdirSync(join(ROOT, WINDOWS_JOB_DIR), { recursive: true });
  const built = Bun.spawnSync(
    [
      "zig",
      "cc",
      "-target",
      "x86_64-windows-gnu",
      "-std=c11",
      "-Os",
      "-s",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-municode",
      WINDOWS_JOB_SOURCE,
      "-o",
      WINDOWS_JOB_PATH,
    ],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  if (built.exitCode !== 0) throw new Error(`Windows helper crossbuild failed (${built.exitCode})`);
  const read = (path: string) => readFileSync(join(ROOT, path));
  const exe = read(WINDOWS_JOB_PATH);
  const record: WindowsJobRecord = {
    v: "mitori.windows-job/1",
    platform: "windows-x64",
    path: WINDOWS_JOB_PATH,
    sha256: windowsJobHash(exe),
    bytes: exe.length,
    sourceSha256: windowsJobHash(read(WINDOWS_JOB_SOURCE)),
    buildSha256: windowsJobHash(read(WINDOWS_JOB_BUILD)),
    compiler: { name: "zig", version: new TextDecoder().decode(version.stdout).trim() },
  };
  const errors = verifyWindowsJob(record, read);
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(join(ROOT, WINDOWS_JOB_RECORD), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(buildWindowsJob(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
