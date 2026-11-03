import { describe, expect, test } from "bun:test";
import { checkBinaryNixFree, checkElfNixFree, checkMachONixFree } from "./standalone-check.ts";

// minimal 64-bit little-endian ELF builder: one PT_INTERP plus optional
// PT_LOAD + PT_DYNAMIC with a single DT_RUNPATH/DT_RPATH string
function elf(opts: { machine?: number; interp?: string; runpath?: string; runpathTag?: number }): Uint8Array {
  const enc = new TextEncoder();
  const interp = opts.interp !== undefined ? [...enc.encode(opts.interp), 0] : [];
  const run = opts.runpath !== undefined ? [...enc.encode(opts.runpath), 0] : [];
  const hasDyn = run.length > 0;
  // layout: ehdr(64) + phdrs + interp + [dynstr + dynamic]
  const phnum = hasDyn ? 3 : 1;
  const phoff = 64;
  const interpOff = phoff + phnum * 56;
  const dynstrOff = interpOff + interp.length;
  const dynOff = dynstrOff + run.length;
  const total = dynOff + (hasDyn ? 32 : 0);
  const bytes = new Uint8Array(total);
  const v = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0);
  v.setUint16(16, 2, true); // ET_EXEC
  v.setUint16(18, opts.machine ?? 62, true); // EM_X86_64 (183 = AARCH64)
  v.setUint32(20, 1, true);
  v.setBigUint64(32, BigInt(phoff), true);
  v.setUint16(52, 64, true);
  v.setUint16(54, 56, true);
  v.setUint16(56, phnum, true);
  const phdr = (i: number, type: number, offset: number, vaddr: number, filesz: number, flags = 4) => {
    const o = phoff + i * 56;
    v.setUint32(o, type, true);
    v.setUint32(o + 4, flags, true);
    v.setBigUint64(o + 8, BigInt(offset), true);
    v.setBigUint64(o + 16, BigInt(vaddr), true);
    v.setBigUint64(o + 32, BigInt(filesz), true);
    v.setBigUint64(o + 40, BigInt(filesz), true);
    v.setBigUint64(o + 48, BigInt(0x1000), true);
  };
  phdr(0, 3, interpOff, 0, interp.length); // PT_INTERP
  if (hasDyn) {
    const base = 0x400000;
    phdr(1, 1, 0, base, total, 5); // PT_LOAD covers the whole file
    phdr(2, 2, dynOff, base + dynOff, 32, 6); // PT_DYNAMIC
    v.setBigInt64(dynOff, BigInt(opts.runpathTag ?? 29), true); // DT_RUNPATH (15 = DT_RPATH)
    v.setBigUint64(dynOff + 8, BigInt(base + dynstrOff), true);
    v.setBigInt64(dynOff + 16, BigInt(0), true); // DT_NULL
  }
  bytes.set(interp, interpOff);
  bytes.set(run, dynstrOff);
  return bytes;
}

// minimal 64-bit little-endian Mach-O builder: one LC_LOAD_DYLIB
function macho(dylib: string): Uint8Array {
  const enc = new TextEncoder();
  const name = [...enc.encode(dylib), 0];
  const cmdsize = 24 + name.length;
  const padded = cmdsize + ((8 - (cmdsize % 8)) % 8);
  const bytes = new Uint8Array(32 + padded);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0xfeedfacf, true); // MH_MAGIC_64
  v.setUint32(16, 1, true); // ncmds
  v.setUint32(32, 0x0c, true); // LC_LOAD_DYLIB
  v.setUint32(36, padded, true);
  v.setUint32(40, 24, true); // name offset from the command start
  bytes.set(name, 56);
  return bytes;
}

describe("WP37c standalone Nix check", () => {
  test("WP37c ELF linux-x64 with the system interpreter passes", () => {
    expect(checkElfNixFree(elf({ interp: "/lib64/ld-linux-x86-64.so.2" }), "linux-x64")).toEqual([]);
  });

  test("WP37c ELF linux-arm64 with the system interpreter passes", () => {
    expect(checkElfNixFree(elf({ machine: 183, interp: "/lib/ld-linux-aarch64.so.1" }), "linux-arm64")).toEqual([]);
  });

  test("WP37c ELF with a /nix/store interpreter fails", () => {
    const problems = checkElfNixFree(elf({ interp: "/nix/store/h4wfwic161kxrr74jlzla5lsm28hgary-glibc-2.44-25/lib/ld-linux-x86-64.so.2" }), "linux-x64");
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/PT_INTERP/);
  });

  test("WP37c ELF with a /nix/store RUNPATH fails", () => {
    const problems = checkElfNixFree(elf({ interp: "/lib64/ld-linux-x86-64.so.2", runpath: "/nix/store/abc-lib/lib" }), "linux-x64");
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/RUNPATH/);
  });

  test("WP37c ELF with a /nix/store RPATH fails", () => {
    const problems = checkElfNixFree(elf({ interp: "/lib64/ld-linux-x86-64.so.2", runpath: "/nix/store/abc-lib/lib", runpathTag: 15 }), "linux-x64");
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/RPATH/);
  });

  test("WP37c ELF with a clean RUNPATH passes", () => {
    expect(checkElfNixFree(elf({ interp: "/lib64/ld-linux-x86-64.so.2", runpath: "/usr/lib" }), "linux-x64")).toEqual([]);
  });

  test("WP37c non-ELF bytes fail closed", () => {
    expect(checkElfNixFree(new TextEncoder().encode("#!/bin/sh\necho hi\n"), "linux-x64").length).toBe(1);
  });

  test("WP37c Mach-O with a system dylib passes", () => {
    expect(checkMachONixFree(macho("/usr/lib/libSystem.B.dylib"))).toEqual([]);
  });

  test("WP37c Mach-O with a /nix/store dylib fails", () => {
    const problems = checkMachONixFree(macho("/nix/store/abc-libc/lib/libc.dylib"));
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/nix\/store/);
  });

  test("WP37c checkBinaryNixFree skips Windows and dispatches by target", () => {
    expect(checkBinaryNixFree(new Uint8Array([0x4d, 0x5a]), "windows-x64")).toEqual([]);
    expect(checkBinaryNixFree(elf({ interp: "/lib64/ld-linux-x86-64.so.2" }), "linux-x64")).toEqual([]);
    expect(checkBinaryNixFree(macho("/usr/lib/libSystem.B.dylib"), "darwin-arm64")).toEqual([]);
  });
});
