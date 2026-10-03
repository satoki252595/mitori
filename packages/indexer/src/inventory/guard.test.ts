// UXP-23: the not-a-project guard and the enumeration caps (200k entries / 2 s).
import { describe, expect, test } from "bun:test";
import type { FsReader, FsStat, GitReader } from "@mitori/core";
import { DEFAULT_DENY_GLOBS } from "@mitori/core";
import { compileSettings } from "./classify.ts";
import { ENUM_LIMITS, enumerate } from "./enumerate.ts";
import { assertProject, notProjectReason } from "./guard.ts";

const dirs: Record<string, string[]> = {
  "/u/me/proj": ["src", "README.md"],
  "/u/me/notes": ["todo.txt"],
  "/u/me/sol": ["App.sln"],
};
const fs = { readdir: (abs: string) => dirs[abs] ?? null };

describe("UXP-23 not-a-project guard", () => {
  test("refuses home, roots, Desktop/Documents/Downloads, ~/Library and marker-less dirs", () => {
    expect(notProjectReason("/", "/u/me", fs)).toBe("filesystem root");
    expect(notProjectReason("/Users", "/u/me", fs)).toBe("filesystem root");
    expect(notProjectReason("/u/me", "/u/me", fs)).toBe("home directory");
    expect(notProjectReason("/u/me/Documents", "/u/me", fs)).toBe("~/Documents");
    expect(notProjectReason("/u/me/Library/Caches/x", "/u/me", fs)).toBe("~/Library");
    expect(notProjectReason("/u/me/notes", "/u/me", fs)).toBe("no project marker");
    expect(notProjectReason("/u/me/proj", "/u/me", fs)).toBeNull();
    expect(notProjectReason("/u/me/sol", "/u/me", fs)).toBeNull();
    expect(() => assertProject("/u/me", "/u/me", fs)).toThrow(expect.objectContaining({ code: "E_WS_NOT_PROJECT" }));
    expect(() => assertProject("/u/me", "/u/me", fs, true)).not.toThrow();
  });
});

describe("UXP-23 enumeration caps", () => {
  test(`more than ${ENUM_LIMITS.maxEntries} entries are cut (path order) and reported as truncated`, async () => {
    const n = ENUM_LIMITS.maxEntries + 5;
    const ls = Array.from({ length: n }, (_, i) => ({ path: `f/${String(i).padStart(7, "0")}.txt`, blob: "", mode: "", stage: 0 as const, tracked: false }));
    const stat: FsStat = { size: 10, mtimeNs: 1n, ino: 1n, isFile: true, isDir: false, isSymlink: false };
    const git = {
      lsFiles: async () => ls,
      head: async () => null,
      headTree: async () => null,
      branch: async () => null,
      objectFormat: async () => "sha1" as const,
      gitDir: async () => "/nonexistent/.git",
      statusDirty: async () => [],
      checkAttr: async () => ({}),
    } as unknown as GitReader;
    const reader = { stat: (abs: string) => (abs.includes("/.git/") ? null : stat) } as unknown as FsReader;
    let t = 0;
    const r = await enumerate({
      git,
      fs: reader,
      root: "/r",
      settings: compileSettings({ denyGlobs: [...DEFAULT_DENY_GLOBS], include: [], exclude: [] }),
      settingsKey: "k",
      prev: null,
      prevSettingsKey: null,
      prevGit: null,
      gen: 1,
      startMs: 0,
      now: () => t++,
      force: false,
    });
    expect(r.truncated).toBe(true);
    expect(r.files.size).toBe(ENUM_LIMITS.maxEntries);
    expect(r.files.has(`f/${String(n - 1).padStart(7, "0")}.txt`)).toBe(false);
  });
  test("the 2 s budget stops the stat pass", async () => {
    const ls = Array.from({ length: 2_000 }, (_, i) => ({ path: `f${i}.ts`, blob: "", mode: "", stage: 0 as const, tracked: false }));
    const git = {
      lsFiles: async () => ls,
      head: async () => null,
      headTree: async () => null,
      branch: async () => null,
      objectFormat: async () => "sha1",
      gitDir: async () => "/g",
    } as unknown as GitReader;
    const reader = { stat: () => ({ size: 1, mtimeNs: 1n, ino: 1n, isFile: true, isDir: false, isSymlink: false }) } as unknown as FsReader;
    let t = 0;
    const r = await enumerate({
      git,
      fs: reader,
      root: "/r",
      settings: compileSettings({ denyGlobs: [], include: [], exclude: [] }),
      settingsKey: "k",
      prev: null,
      prevSettingsKey: null,
      prevGit: null,
      gen: 1,
      startMs: 0,
      now: () => (t += 1_000), // the clock is sampled every 256 entries
      force: false,
    });
    expect(r.truncated).toBe(true);
    expect(r.files.size).toBeLessThan(2_000);
  });
});
