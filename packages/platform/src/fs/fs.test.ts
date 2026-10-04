import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MitoriError, type SafeWriteKind } from "@mitori/core";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { createFsReader, createSafeWriter, createSelfWriteLog, resolveHome, SAFE_WRITE_RULES } from "./index.ts";

afterAll(cleanupTempDirs);

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return MitoriError.is(e) ? e.code : `other:${(e as Error).message}`;
  }
};
const tree = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();
const read = (p: string) => readFileSync(p, "utf8");

describe("SafeWriter allowlists (SEC-01)", () => {
  const ok: [SafeWriteKind, string][] = [
    ["doc", "doc/00-tldr.md"],
    ["doc", "doc/99-appendix.md"],
    ["doc", "doc/modules/auth-core.md"],
    ["doc", "decisions/dc_abcdefgh.md"],
    ["doc", "orphaned/internal-server.md"],
    ["doc", "mitori.json"],
    ["doc", "doc.index.json"],
    ["doc", "cache/html/x.json"],
    ["doc", ".gitignore"],
    ["prep", "tmp/prep/pr_0123abcd/README.md"],
    ["prep", "tmp/prep/pr_0123abcd"],
    ["integration", ".claude/skills/mitori-review/SKILL.md"],
    ["integration", ".mitori/integrations/claude-code/plugins/mitori/hooks/hooks.json"],
    ["integration", ".mitori/integrations/claude-code/plugins/mitori/agents/mitori-gen-writer.md"],
    ["repo_meta", "AGENTS.md"],
    ["accept", "src/a b/ファイル.ts"],
    ["accept", ".gitattributes"],
    ["accept", "docs/.github/x.md"],
    ["home", "repos/ws_x/side.git/HEAD"],
  ];
  const bad: [SafeWriteKind, string][] = [
    ["doc", "doc/evil.md"],
    ["doc", "doc/modules/UPPER.md"],
    ["doc", "doc/modules/../../../.claude/CLAUDE.md"],
    ["doc", "decisions/dc_ilou0000.md"],
    ["doc", "orphaned/../doc/00-tldr.md"],
    ["doc", "orphaned/x/y.md"],
    ["doc", "tmp/prep/pr_0123abcd/x"],
    ["prep", "tmp/prep/../../x"],
    ["repo_meta", "sub/AGENTS.md"],
    ["accept", ".git/config"],
    ["accept", "vendor/.GIT/hooks/pre-commit"],
    ["accept", ".g‌it/config"], // HFS+ ignores U+200C: this IS .git there
    ["accept", "sub/﻿.git/hooks/post-checkout"],
    ["accept", ".git./config"], // NTFS drops trailing dots/spaces
    ["accept", ".git /config"],
    ["accept", "/etc/passwd"],
    ["accept", "a\\b"],
    ["accept", "a\0b"],
    ["accept", "./a"],
    ["accept", "a//b"],
    ["accept", ""],
    ["home", "../x"],
  ];
  const w = createSafeWriter();
  test.each(ok)("%s allows %p", async (kind, rel) => {
    expect(SAFE_WRITE_RULES[kind].test(rel)).toBe(true);
    if (kind !== "prep" || rel.includes("/README")) expect(await codeOf(w.write(tempDir(), rel, "x", kind))).toBe("ok");
  });
  test.each(bad)("%s refuses %p", async (kind, rel) => {
    const root = tempDir();
    expect(await codeOf(w.write(root, rel, "x", kind))).toBe("E_PATH_OUTSIDE");
    expect(tree(root)).toEqual([]);
  });
});

describe("PLAT-I-003 SafeWriter atomic write", () => {
  test("creates directories one by one; file 0644 / dir 0755, home 0600 / 0700; exact bytes", async () => {
    const self = createSelfWriteLog();
    const w = createSafeWriter({ selfWrites: self });
    const root = tempDir();
    await w.write(root, "doc/modules/a.md", "# A\n", "doc");
    expect(read(join(root, "doc/modules/a.md"))).toBe("# A\n");
    expect(statSync(join(root, "doc/modules/a.md")).mode & 0o777).toBe(0o644);
    expect(statSync(join(root, "doc/modules")).mode & 0o777).toBe(0o755);
    expect(self.isEcho(join(root, "doc/modules/a.md"), new TextEncoder().encode("# A\n"))).toBe(true);
    const home = tempDir();
    await w.write(home, "run/sp/abc.txt", new Uint8Array([1, 2, 3]), "home");
    expect(statSync(join(home, "run/sp/abc.txt")).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "run")).mode & 0o777).toBe(0o700);
    expect(tree(root)).toEqual(["doc", "doc/modules", "doc/modules/a.md"]);
  });

  test("an existing file keeps its mode; identical content is not rewritten (mtime unchanged, no echo record)", async () => {
    const self = createSelfWriteLog();
    const w = createSafeWriter({ selfWrites: self });
    const root = tempDir();
    writeFileSync(join(root, "run.sh"), "old", { mode: 0o755 });
    await w.write(root, "run.sh", "new", "accept");
    expect(statSync(join(root, "run.sh")).mode & 0o777).toBe(0o755);
    const before = lstatSync(join(root, "run.sh"), { bigint: true });
    await Bun.sleep(5);
    const self2 = createSelfWriteLog();
    await createSafeWriter({ selfWrites: self2 }).write(root, "run.sh", "new", "accept");
    expect(lstatSync(join(root, "run.sh"), { bigint: true }).mtimeNs).toBe(before.mtimeNs);
    expect(lstatSync(join(root, "run.sh"), { bigint: true }).ino).toBe(before.ino);
    expect(self2.has(join(root, "run.sh"))).toBe(false);
  });

  test("a failure between temp write and rename leaves the original byte-identical and no temp file", async () => {
    const root = tempDir();
    writeFileSync(join(root, "README.md"), "original");
    const w = createSafeWriter({
      beforeRename: () => {
        throw new Error("disk on fire");
      },
    });
    expect(await codeOf(w.write(root, "README.md", "replacement", "doc"))).toBe("other:disk on fire");
    expect(read(join(root, "README.md"))).toBe("original");
    expect(tree(root)).toEqual(["README.md"]);
  });
});

describe("RT-25..28 (platform part): symlinks and escapes write 0 bytes outside the root", () => {
  const w = createSafeWriter();

  test("RT-25 committed `.mitori` symlink → outside: the root itself is refused", async () => {
    const repo = tempDir();
    const outside = tempDir();
    symlinkSync(outside, join(repo, ".mitori"));
    expect(await codeOf(w.write(join(repo, ".mitori"), "README.md", "x", "doc"))).toBe("E_PATH_SYMLINK");
    expect(await codeOf(w.write(join(repo, ".mitori"), "doc/00-tldr.md", "x", "doc"))).toBe("E_PATH_SYMLINK");
    expect(tree(outside)).toEqual([]);
  });

  test("RT-26 slug traversal `../../../.claude/CLAUDE` is refused before any fs access", async () => {
    const repo = tempDir();
    mkdirSync(join(repo, ".mitori"));
    expect(await codeOf(w.write(join(repo, ".mitori"), "doc/modules/../../../.claude/CLAUDE.md", "x", "doc"))).toBe("E_PATH_OUTSIDE");
    expect(tree(repo)).toEqual([".mitori"]);
  });

  test("RT-27 a symlinked directory component inside the root (docDir/doc → outside)", async () => {
    const doc = tempDir();
    const outside = tempDir();
    symlinkSync(outside, join(doc, "doc"));
    expect(await codeOf(w.write(doc, "doc/00-tldr.md", "x", "doc"))).toBe("E_PATH_SYMLINK");
    mkdirSync(join(doc, "real"));
    symlinkSync(outside, join(doc, "real", "deep"));
    expect(await codeOf(w.write(doc, "cache/../real/deep/x", "x", "doc"))).toBe("E_PATH_OUTSIDE");
    expect(await codeOf(w.write(doc, "x/y", "x", "accept"))).toBe("ok");
    expect(await codeOf(w.write(doc, "real/deep/x", "x", "accept"))).toBe("E_PATH_SYMLINK");
    expect(tree(outside)).toEqual([]);
  });

  test("RT-27 a symlinked target file (doc kind) is refused and left alone", async () => {
    const doc = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, "victim"), "keep");
    mkdirSync(join(doc, "doc"));
    symlinkSync(join(outside, "victim"), join(doc, "doc/00-tldr.md"));
    expect(await codeOf(w.write(doc, "doc/00-tldr.md", "x", "doc"))).toBe("E_PATH_SYMLINK");
    expect(read(join(outside, "victim"))).toBe("keep");
    expect(lstatSync(join(doc, "doc/00-tldr.md")).isSymbolicLink()).toBe(true);
  });

  test("RT-28 AGENTS.md / CLAUDE.md / .gitattributes symlinked outside the repo are refused", async () => {
    const repo = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, "CLAUDE.md"), "user's global instructions");
    symlinkSync(join(outside, "CLAUDE.md"), join(repo, "CLAUDE.md"));
    symlinkSync(join(outside, "AGENTS.md"), join(repo, "AGENTS.md")); // dangling
    symlinkSync(join(repo, ".git", "info", "attributes"), join(repo, ".gitattributes"));
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    writeFileSync(join(repo, ".git", "info", "attributes"), "");
    expect(await codeOf(w.write(repo, "CLAUDE.md", "managed", "repo_meta"))).toBe("E_PATH_OUTSIDE");
    expect(await codeOf(w.write(repo, "AGENTS.md", "managed", "repo_meta"))).toBe("E_PATH_SYMLINK");
    expect(await codeOf(w.write(repo, ".gitattributes", "managed", "repo_meta"))).toBe("E_PATH_OUTSIDE");
    expect(read(join(outside, "CLAUDE.md"))).toBe("user's global instructions");
    expect(tree(outside)).toEqual(["CLAUDE.md"]);
    expect(read(join(repo, ".git", "info", "attributes"))).toBe("");
  });

  test("RT-28 a repo_meta symlink whose realpath stays in the repo is followed (the link is kept)", async () => {
    const repo = tempDir();
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs", "AGENTS.md"), "old");
    symlinkSync("docs/AGENTS.md", join(repo, "AGENTS.md"));
    await w.write(repo, "AGENTS.md", "new", "repo_meta");
    expect(read(join(repo, "docs", "AGENTS.md"))).toBe("new");
    expect(readlinkSync(join(repo, "AGENTS.md"))).toBe("docs/AGENTS.md");
    // only repo_meta follows: the same link for an accept write is refused
    expect(await codeOf(w.write(repo, "AGENTS.md", "x", "accept"))).toBe("E_PATH_SYMLINK");
  });

  test("a symlink swapped in right before rename (TOCTOU) is refused; nothing leaks", async () => {
    const doc = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, "victim"), "keep");
    const w2 = createSafeWriter({
      beforeRename: (target) => {
        rmSync(target, { force: true });
        symlinkSync(join(outside, "victim"), target);
      },
    });
    writeFileSync(join(doc, "README.md"), "original");
    expect(await codeOf(w2.write(doc, "README.md", "attack", "doc"))).toBe("E_PATH_SYMLINK");
    expect(read(join(outside, "victim"))).toBe("keep");
    expect(tree(doc)).toEqual(["README.md"]);
    // a parent directory swapped for a symlink before rename is caught by the re-walk
    mkdirSync(join(doc, "cache"));
    const w3 = createSafeWriter({
      beforeRename: () => {
        rmSync(join(doc, "cache"), { recursive: true, force: true });
        symlinkSync(outside, join(doc, "cache"));
      },
    });
    expect(await codeOf(w3.write(doc, "cache/x.json", "{}", "doc"))).toBe("E_PATH_SYMLINK");
    expect(tree(outside)).toEqual(["victim"]);
  });

  test("a root that is not a directory or not absolute is refused", async () => {
    const root = tempDir();
    writeFileSync(join(root, "f"), "");
    expect(await codeOf(w.write(join(root, "f"), "README.md", "x", "doc"))).toBe("E_INVALID_INPUT");
    expect(await codeOf(w.write("relative/root", "README.md", "x", "doc"))).toBe("E_INVALID_INPUT");
    expect(await codeOf(w.write(join(root, "missing"), "README.md", "x", "doc"))).toBe("E_NOT_FOUND");
  });
});

describe("SafeWriter.remove", () => {
  const self = createSelfWriteLog();
  const w = createSafeWriter({ selfWrites: self });

  test("removes files, no-ops on missing, refuses symlinks and non-recursive kinds' directories", async () => {
    const root = tempDir();
    const outside = tempDir();
    await w.write(root, "cache/a.json", "{}", "doc");
    await w.remove(root, "cache/a.json", "doc");
    expect(existsSync(join(root, "cache/a.json"))).toBe(false);
    expect(self.isEcho(join(root, "cache/a.json"), null)).toBe(true);
    await w.remove(root, "cache/missing.json", "doc");
    await w.remove(root, "nothere/x.json", "accept");
    symlinkSync(outside, join(root, "cache", "link"));
    expect(await codeOf(w.remove(root, "cache/link", "doc"))).toBe("E_PATH_SYMLINK");
    mkdirSync(join(root, "cache", "dir"));
    expect(await codeOf(w.remove(root, "cache/dir", "doc"))).toBe("E_INVALID_INPUT");
  });

  test("prep and home directories are removed recursively without following inner symlinks", async () => {
    const doc = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, "keep"), "k");
    await w.write(doc, "tmp/prep/pr_0123abcd/out/a.md", "x", "prep");
    symlinkSync(outside, join(doc, "tmp/prep/pr_0123abcd/out/escape"));
    await w.remove(doc, "tmp/prep/pr_0123abcd", "prep");
    expect(existsSync(join(doc, "tmp/prep/pr_0123abcd"))).toBe(false);
    expect(tree(outside)).toEqual(["keep"]);
  });
});

describe("PLAT-U-009 resolveHome", () => {
  test("MITORI_HOME wins and is created 0700; relative is refused; default is ~/.mitori", () => {
    const base = tempDir();
    const home = resolveHome({ env: { MITORI_HOME: join(base, "h") } });
    expect(home).toBe(join(base, "h"));
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(() => resolveHome({ env: { MITORI_HOME: "rel/h" } })).toThrow(MitoriError);
    expect(resolveHome({ env: { HOME: "/x" }, create: false }).endsWith("/.mitori")).toBe(true);
  });

  test("registry-style files written under home are 0600", async () => {
    const home = resolveHome({ env: { MITORI_HOME: join(tempDir(), "h") } });
    await createSafeWriter().write(home, "daemon.json", "{}", "home");
    expect(statSync(join(home, "daemon.json")).mode & 0o777).toBe(0o600);
    // an identical rewrite of a world-readable home file (older version / user copy) still tightens it to 0600
    writeFileSync(join(home, "registry.json"), "{}", { mode: 0o644 });
    await createSafeWriter().write(home, "registry.json", "{}", "home");
    expect(statSync(join(home, "registry.json")).mode & 0o777).toBe(0o600);
  });
});

describe("FsReader", () => {
  const fs = createFsReader();
  test("stat (lstat, ns mtime), read, readHead, realpath, readdir; null when missing", async () => {
    const root = tempDir();
    writeFileSync(join(root, "a.txt"), "hello world");
    symlinkSync("a.txt", join(root, "l"));
    const st = fs.stat(join(root, "a.txt"));
    expect(st).toMatchObject({ size: 11, isFile: true, isDir: false, isSymlink: false });
    expect(typeof st?.mtimeNs).toBe("bigint");
    expect(fs.stat(join(root, "l"))?.isSymlink).toBe(true);
    expect(fs.stat(join(root, "nope"))).toBeNull();
    expect(fs.stat(join(root, "a.txt", "x"))).toBeNull();
    expect(new TextDecoder().decode(await fs.read(join(root, "a.txt")))).toBe("hello world");
    expect(new TextDecoder().decode(await fs.readHead(join(root, "a.txt"), 5))).toBe("hello");
    expect((await fs.readHead(join(root, "a.txt"), 100)).length).toBe(11);
    expect(fs.realpath(join(root, "l"))).toBe(join(root, "a.txt"));
    expect(fs.realpath(join(root, "nope"))).toBeNull();
    expect(fs.readdir(root)?.sort()).toEqual(["a.txt", "l"]);
    expect(fs.readdir(join(root, "a.txt"))).toBeNull();
    expect(fs.readdir(join(root, "nope"))).toBeNull();
  });
});
