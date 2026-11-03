// Exit check for `bun build --compile` output (WP37c): a binary built from the Nix-patched
// bun carries a `/nix/store` interpreter (Linux) or dylib (macOS) and cannot start outside Nix.
// Both build exits (`build-bin.ts`, `release.ts`) run this; any problem fails the build.
// Pure byte readers (no `readelf` — the devShell has none); Windows is out of scope.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.ts";

const NIX_STORE = "/nix/store";
const INTERP: Record<string, string> = {
  "linux-x64": "/lib64/ld-linux-x86-64.so.2",
  "linux-arm64": "/lib/ld-linux-aarch64.so.1",
};

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const cstr = (bytes: Uint8Array, off: number, end: number): string | null => {
  if (off < 0 || off >= end) return null;
  let stop = off;
  while (stop < end && bytes[stop] !== 0) stop++;
  if (stop >= end) return null;
  return new TextDecoder().decode(bytes.subarray(off, stop));
};

/** ELF PT_INTERP + DT_RUNPATH/DT_RPATH check (`target` is `linux-x64` / `linux-arm64`). */
export function checkElfNixFree(bytes: Uint8Array, target: string): string[] {
  const problems: string[] = [];
  const v = view(bytes);
  const ok = (cond: boolean, msg: string) => {
    if (!cond) problems.push(msg);
    return cond;
  };
  if (!ok(bytes.length >= 64 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46, `${target}: not an ELF executable`))
    return problems;
  const cls = bytes[4]; // 1 = 32-bit, 2 = 64-bit
  const le = bytes[5] === 1;
  if (!ok((cls === 1 || cls === 2) && (bytes[5] === 1 || bytes[5] === 2), `${target}: unsupported ELF class/encoding`)) return problems;
  const u16 = (o: number) => (le ? v.getUint16(o, true) : v.getUint16(o, false));
  const u32 = (o: number) => (le ? v.getUint32(o, true) : v.getUint32(o, false));
  const u64 = (o: number) => Number(le ? v.getBigUint64(o, true) : v.getBigUint64(o, false));
  const i64 = (o: number) => Number(le ? v.getBigInt64(o, true) : v.getBigInt64(o, false));
  const ptr = cls === 2 ? 8 : 4;
  const phoff = cls === 2 ? u64(32) : u32(28);
  const phentsize = u16(cls === 2 ? 54 : 42);
  const phnum = u16(cls === 2 ? 56 : 44);
  if (!ok(Number.isSafeInteger(phoff) && phoff >= 0 && phentsize >= (cls === 2 ? 56 : 32) && phnum > 0, `${target}: bad ELF program header table`))
    return problems;
  // vaddr → file offset through the PT_LOAD segments (DT_RUNPATH holds a virtual address)
  const loads: { vaddr: number; offset: number; filesz: number }[] = [];
  let interp: string | null = null;
  let dynamic: { offset: number; filesz: number } | null = null;
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (o + phentsize > bytes.length) {
      problems.push(`${target}: ELF program header ${i} out of range`);
      return problems;
    }
    const type = u32(o);
    const off = cls === 2 ? u64(o + 8) : u32(o + 4);
    const vaddr = cls === 2 ? u64(o + 16) : u32(o + 8);
    const filesz = cls === 2 ? u64(o + 32) : u32(o + 16);
    if (type === 1) loads.push({ vaddr, offset: off, filesz });
    if (type === 3) interp = cstr(bytes, off, Math.min(off + filesz, bytes.length));
    if (type === 2) dynamic = { offset: off, filesz };
  }
  const expected = INTERP[target];
  if (expected !== undefined && interp !== expected) problems.push(`${target}: PT_INTERP is ${JSON.stringify(interp)} (want ${expected})`);
  if (dynamic) {
    const { offset, filesz } = dynamic;
    for (let o = offset; o + ptr * 2 <= Math.min(offset + filesz, bytes.length); o += ptr * 2) {
      const tag = cls === 2 ? i64(o) : le ? v.getInt32(o, true) : v.getInt32(o, false);
      const val = cls === 2 ? u64(o + 8) : u32(o + 4);
      if (tag !== 15 && tag !== 29) continue; // DT_RPATH / DT_RUNPATH
      const seg = loads.find((s) => val >= s.vaddr && val < s.vaddr + s.filesz);
      const path = seg ? cstr(bytes, seg.offset + (val - seg.vaddr), bytes.length) : null;
      const kind = tag === 15 ? "DT_RPATH" : "DT_RUNPATH";
      if (path === null) problems.push(`${target}: ${kind} points outside the file`);
      else if (path.includes(NIX_STORE)) problems.push(`${target}: ${kind} references ${path}`);
    }
  }
  return problems;
}

/** Mach-O LC_LOAD_DYLIB (+ weak/re-export/lazy/upward) check, including fat slices. */
export function checkMachONixFree(bytes: Uint8Array): string[] {
  const problems: string[] = [];
  const v = view(bytes);
  if (bytes.length < 4) return ["darwin: too short for a Mach-O header"];
  const magic = v.getUint32(0, true);
  if (magic === 0xbebafeca || magic === 0xbebafecb) {
    const nfat = v.getUint32(4, false);
    for (let i = 0; i < nfat; i++) {
      const o = 8 + i * 20;
      const off = v.getUint32(o + 8, false);
      const size = v.getUint32(o + 12, false);
      if (o + 20 > bytes.length || off + size > bytes.length) {
        problems.push("darwin: fat slice out of range");
        continue;
      }
      for (const p of checkMachOSlice(bytes.subarray(off, off + size))) problems.push(p);
    }
    if (nfat === 0) problems.push("darwin: fat binary with no slices");
    return problems;
  }
  return checkMachOSlice(bytes);
}

const DYLIB_CMDS = new Set([0x0c, 0x18, 0x1f, 0x20, 0x80000023]); // LOAD(_WEAK)/REEXPORT/LAZY/UPWARD_DYLIB

function checkMachOSlice(bytes: Uint8Array): string[] {
  const v = view(bytes);
  if (bytes.length < 32) return ["darwin: too short for a Mach-O header"];
  const magic = v.getUint32(0, true);
  const le64 = magic === 0xfeedfacf;
  const le32 = magic === 0xfeedface;
  if (!le64 && !le32) return ["darwin: not a little-endian Mach-O executable"];
  const ncmds = v.getUint32(16, true);
  let o = le64 ? 32 : 28;
  for (let i = 0; i < ncmds; i++) {
    if (o + 8 > bytes.length) return ["darwin: load command out of range"];
    const cmd = v.getUint32(o, true);
    const cmdsize = v.getUint32(o + 4, true);
    if (cmdsize < 8 || o + cmdsize > bytes.length) return ["darwin: bad load command size"];
    if (DYLIB_CMDS.has(cmd)) {
      const nameOff = v.getUint32(o + 8, true);
      const name = nameOff + 1 < cmdsize ? cstr(bytes, o + nameOff, o + cmdsize) : null;
      if (name === null) return ["darwin: bad dylib name in load command"];
      if (name.includes(NIX_STORE)) return [`darwin: dylib references ${name}`];
    }
    o += cmdsize;
  }
  return [];
}

/** Dispatch by target; Windows is out of scope and always passes. */
export function checkBinaryNixFree(bytes: Uint8Array, target: string): string[] {
  if (target.startsWith("windows-")) return [];
  if (target.startsWith("darwin-")) return checkMachONixFree(bytes);
  return checkElfNixFree(bytes, target);
}

/** Read a built binary under `dist/` and throw when it depends on `/nix/store`. */
export function verifyBuiltBinary(relOrAbs: string, target: string): void {
  if (target.startsWith("windows-")) return;
  const path = relOrAbs.startsWith("/") ? relOrAbs : join(ROOT, relOrAbs);
  const problems = checkBinaryNixFree(readFileSync(path), target);
  if (problems.length > 0) throw new Error(`Nix-dependent ${target} binary (${path}):\n  ${problems.join("\n  ")}`);
}
