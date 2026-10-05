import { expect, test } from "bun:test";
import { verifyWindowsJob, WINDOWS_JOB_BUILD, WINDOWS_JOB_PATH, WINDOWS_JOB_SOURCE, type WindowsJobRecord, windowsJobHash } from "./build-windows-job.ts";

test("native record verifies AMD64 PE and source/build bytes, rejecting stale, corrupt and wrong-platform assets", () => {
  const exe = new Uint8Array(128);
  exe.set([0x4d, 0x5a]);
  new DataView(exe.buffer).setUint32(60, 80, true);
  exe.set([0x50, 0x45, 0, 0, 0x64, 0x86], 80);
  const files = new Map([
    [WINDOWS_JOB_SOURCE, new TextEncoder().encode("source")],
    [WINDOWS_JOB_BUILD, new TextEncoder().encode("build")],
    [WINDOWS_JOB_PATH, exe],
  ]);
  const read = (path: string) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error("missing fixture");
    return bytes;
  };
  const record: WindowsJobRecord = {
    v: "mitori.windows-job/1",
    platform: "windows-x64",
    path: WINDOWS_JOB_PATH,
    sha256: windowsJobHash(exe),
    bytes: exe.length,
    sourceSha256: windowsJobHash(read(WINDOWS_JOB_SOURCE)),
    buildSha256: windowsJobHash(read(WINDOWS_JOB_BUILD)),
    compiler: { name: "zig", version: "0.16.0" },
  };
  expect(verifyWindowsJob(record, read)).toEqual([]);
  expect(
    verifyWindowsJob({ ...record, path: "../outside.exe" }, () => {
      throw new Error("must not read an untrusted record path");
    }),
  ).toEqual(["invalid Windows job record"]);
  expect(verifyWindowsJob({ ...record, sourceSha256: "stale" }, read)).toContain(`${WINDOWS_JOB_SOURCE}: source changed; rebuild the helper`);
  expect(verifyWindowsJob({ ...record, sha256: "tampered" }, read)).toContain("Windows job executable bytes/hash changed");
  exe[84] = 0xaa;
  expect(verifyWindowsJob({ ...record, sha256: windowsJobHash(exe) }, read)).toContain("Windows job must be an AMD64 PE executable");
});
