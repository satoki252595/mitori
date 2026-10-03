// S0a enumeration on fake ports (spec §2.1–2.2): the warm path keeps unchanged records (also excluded untracked files,
// which are never hashed), linguist attributes that disappear are dropped, known paths are stat'ed while git lists.
import { describe, expect, test } from "bun:test";
import type { FsReader, FsStat, GitReader, RepoPath } from "@mitori/core";
import type { FileRec } from "../update/model.ts";
import { compileSettings } from "./classify.ts";
import { type EnumerateInput, enumerate } from "./enumerate.ts";

type LsEntry = Awaited<ReturnType<GitReader["lsFiles"]>>[number];

function fakes(entries: LsEntry[], files: Record<string, number>) {
  const state = { entries, attrs: {} as Record<RepoPath, Record<string, string>>, attrCalls: 0, lsPending: false, statsDuringLs: 0 };
  const stat = (abs: string): FsStat | null => {
    if (state.lsPending) state.statsDuringLs++;
    const rel = abs.replace(/^\/r\//, "");
    if (rel === ".git/index" || rel === ".git/HEAD") return { size: 1, mtimeNs: 5n, ino: 1n, isFile: true, isDir: false, isSymlink: false };
    const size = files[rel];
    return size === undefined ? null : { size, mtimeNs: 1_000_000_000n, ino: BigInt(size), isFile: true, isDir: false, isSymlink: false };
  };
  const fs: FsReader = { stat, read: async () => new Uint8Array(), readHead: async () => new Uint8Array(), realpath: (p) => p, readdir: () => [] };
  const no = () => Promise.reject(new Error("unused"));
  const git: GitReader = {
    lsFiles: () => {
      state.lsPending = true;
      return new Promise((resolve) =>
        setTimeout(() => {
          state.lsPending = false;
          resolve(state.entries);
        }, 1),
      );
    },
    lsOthers: no,
    status: async () => [],
    statusDirty: async () => [],
    checkAttr: async (paths) => {
      state.attrCalls++;
      const out: Record<RepoPath, Record<string, string>> = {};
      for (const p of paths) if (state.attrs[p] !== undefined) out[p] = state.attrs[p] as Record<string, string>;
      return out;
    },
    catBlob: no,
    head: async () => "c".repeat(40),
    headTree: async () => "t".repeat(40),
    branch: async () => "main",
    gitDir: async () => "/r/.git",
    diffNames: no,
    log: no,
    revCount: no,
    isShallow: async () => false,
    objectFormat: async () => "sha1",
  };
  return { state, fs, git };
}

const settings = compileSettings({ denyGlobs: [], include: [], exclude: [] });

function input(f: ReturnType<typeof fakes>, prev: EnumerateResultLike | null, gen: number): EnumerateInput {
  return {
    git: f.git,
    fs: f.fs,
    root: "/r",
    settings,
    settingsKey: "k",
    prev: prev?.files ?? null,
    prevSettingsKey: prev === null ? null : "k",
    prevGit: prev?.git ?? null,
    gen,
    startMs: 10_000_000,
    now: () => performance.now(),
    force: false,
  };
}

type EnumerateResultLike = Awaited<ReturnType<typeof enumerate>>;

/** What the scan does between enumerations: tracked files get their index blob, read files a hashed blob. */
function settle(r: EnumerateResultLike): EnumerateResultLike {
  for (const rec of r.files.values()) {
    if (rec.excluded === undefined && rec.blob === "") rec.blob = "h".repeat(40);
    rec.racy = false;
  }
  return r;
}

describe("IDX-AT-16 warm enumeration", () => {
  test("an unchanged listing keeps every record (excluded untracked files have no blob) and reports `unchanged`", async () => {
    const f = fakes(
      [
        { path: "src/a.ts", blob: "a".repeat(40), mode: "100644", stage: 0, tracked: true },
        { path: "logo.png", blob: "", mode: "", stage: 0, tracked: false },
        { path: "notes.ts", blob: "", mode: "", stage: 0, tracked: false },
      ],
      { "src/a.ts": 10, "logo.png": 20, "notes.ts": 30 },
    );
    const cold = settle(await enumerate(input(f, null, 1)));
    expect(cold.files.get("logo.png")).toMatchObject({ class: "binary", blob: "" });
    const warm = await enumerate(input(f, cold, 2));
    expect(warm.unchanged).toBe(true);
    for (const p of ["src/a.ts", "logo.png", "notes.ts"]) expect(warm.files.get(p)).toBe(cold.files.get(p) as FileRec);
    expect(warm.unknownBlob.size).toBe(0);
  });

  test("known paths are stat'ed while git lists; only new paths afterwards", async () => {
    const f = fakes([{ path: "a.ts", blob: "a".repeat(40), mode: "100644", stage: 0, tracked: true }], { "a.ts": 10, "b.ts": 11 });
    const cold = settle(await enumerate(input(f, null, 1)));
    f.state.entries = [...f.state.entries, { path: "b.ts", blob: "", mode: "", stage: 0, tracked: false }];
    f.state.statsDuringLs = 0;
    const warm = await enumerate(input(f, cold, 2));
    expect(f.state.statsDuringLs).toBe(1); // a.ts
    expect(warm.unchanged).toBe(false);
    expect([...warm.unknownBlob]).toEqual(["b.ts"]);
  });
});

describe("IDX-AT-01 linguist attributes on rescans", () => {
  test("a path whose linguist-vendored attribute was removed is classified from its path again", async () => {
    const attrsV1 = { path: ".gitattributes", blob: "1".repeat(40), mode: "100644", stage: 0 as const, tracked: true };
    const f = fakes([attrsV1, { path: "lib/x.js", blob: "x".repeat(40), mode: "100644", stage: 0, tracked: true }], { ".gitattributes": 5, "lib/x.js": 9 });
    f.state.attrs = { "lib/x.js": { "linguist-vendored": "set" } };
    const cold = settle(await enumerate(input(f, null, 1)));
    expect(cold.files.get("lib/x.js")).toMatchObject({ class: "vendored", excluded: "vendored" });
    // .gitattributes changed (new blob): check-attr runs for every path and returns nothing for lib/x.js.
    f.state.entries = [{ ...attrsV1, blob: "2".repeat(40) }, f.state.entries[1] as LsEntry];
    f.state.attrs = {};
    const warm = await enumerate(input(f, cold, 2));
    expect(warm.ranAttrs).toBe(true);
    expect(warm.files.get("lib/x.js")).toMatchObject({ class: "source", rule: "R19.source" });
    expect(warm.files.get("lib/x.js")?.excluded).toBeUndefined();
  });
});
