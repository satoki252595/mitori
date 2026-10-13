import { describe, expect, test } from "bun:test";
import type { BinaryPin } from "@mitori/core";
import { CODEX_VERSION } from "./adapters/codex-policy.ts";
import {
  type FileId,
  type FollowIo,
  followMuseUpdate,
  followPinUpdate,
  isFollowSafePath,
  isMuseBinPath,
  isOwnershipSafe,
  isValidVersionLine,
  museCandidateFor,
  sameFileId,
} from "./follow.ts";
import { createFakeSpawner, createTestBridge, testHasher, type testSettings } from "./testing.ts";

type Settings = ReturnType<typeof testSettings>;

const enc = new TextEncoder();
const OLD_VERSION = "2.1.100 (Claude Code)";
const NEW_VERSION = "2.1.200 (Claude Code)";
const sha = (s: string) => testHasher.sha256(enc.encode(s));

/** Injected I/O with one moved entry (`entry` → `target`) and canned file bytes. */
function fakeIo(
  entry: string,
  target: string | null,
  files: Record<string, string>,
  over: Partial<FollowIo> = {},
): FollowIo & { versions: Map<string, string>; versionCalls: string[]; sha256Calls: string[]; ids: Map<string, FileId> } {
  const versions = new Map<string, string>();
  const versionCalls: string[] = [];
  const sha256Calls: string[] = [];
  const ids = new Map<string, FileId>();
  let ino = 1;
  for (const [p, text] of Object.entries(files)) ids.set(p, { dev: 7, ino: ino++, size: enc.encode(text).length, mtimeMs: 1000 });
  return {
    realpath: (p) => (p === entry ? target : p in files ? p : null),
    statIsFile: (p) => p in files,
    readText: async (p) => (p in files ? files[p]! : null),
    fileId: (p) => ids.get(p) ?? null,
    sha256File: async (p) => {
      sha256Calls.push(p);
      return p in files ? sha(files[p]!) : null;
    },
    ownership: () => ({ uid: 1000, mode: 0o755 }),
    runVersion: async (c) => {
      versionCalls.push(c);
      return versions.get(c) ?? null;
    },
    euid: 1000,
    platform: "linux",
    workspaceRoots: [],
    ...over,
    versions,
    versionCalls,
    sha256Calls,
    ids,
  };
}

describe("WP28 follow.ts pure decisions", () => {
  test("isValidVersionLine: the setup-pin rule (nonempty, ≤512, no control chars)", () => {
    expect(isValidVersionLine("2.1.200 (Claude Code)")).toBe(true);
    expect(isValidVersionLine("")).toBe(false);
    expect(isValidVersionLine("x".repeat(513))).toBe(false);
    expect(isValidVersionLine("a\nb")).toBe(false);
    expect(isValidVersionLine("a\x7fb")).toBe(false);
  });

  test("museCandidateFor: the binaryOf rule (marker → same-dir muse-bin-<ver>)", () => {
    expect(museCandidateFor("/h/.local/bin", "1.4.7-R6101.1\n", "/h/.local/bin/muse-bin-1.4.6-R6000.1")).toBe("/h/.local/bin/muse-bin-1.4.7-R6101.1");
    expect(museCandidateFor("/h/.local/bin", "1.4.7-R6101.1", "/h/.local/bin/muse-bin-1.4.7-R6101.1")).toBeNull();
    for (const bad of ["", "../evil", "a/b", "-lead", "x".repeat(102)]) expect(museCandidateFor("/d", bad, "/d/muse-bin-1")).toBeNull();
    expect(museCandidateFor("/d", "x".repeat(101), "/d/muse-bin-1")).toBe(`/d/muse-bin-${"x".repeat(101)}`);
    expect(isMuseBinPath("/h/.local/bin/muse-bin-1.4.7")).toBe(true);
    expect(isMuseBinPath("/usr/local/bin/muse")).toBe(false);
  });

  test("isFollowSafePath: workspace / tmp / node_modules/.bin / .venv/bin / relative are out", () => {
    const roots = ["/home/u/work/repo"];
    expect(isFollowSafePath("/opt/claude/versions/2.1.200", { workspaceRoots: roots })).toBe(true);
    expect(isFollowSafePath("/home/u/work/repo/bin/claude", { workspaceRoots: roots })).toBe(false);
    expect(isFollowSafePath("/tmp/evil-claude", { workspaceRoots: roots })).toBe(false);
    expect(isFollowSafePath("/var/folders/x/claude", { workspaceRoots: roots })).toBe(false);
    expect(isFollowSafePath("/home/u/work/node_modules/.bin/claude", { workspaceRoots: [] })).toBe(false);
    expect(isFollowSafePath("/home/u/work/.venv/bin/codex", { workspaceRoots: [] })).toBe(false);
    expect(isFollowSafePath("relative/claude", { workspaceRoots: [] })).toBe(false);
    expect(isFollowSafePath("/scratch/t/claude", { workspaceRoots: [], tmpdir: "/scratch/t/" })).toBe(false);
  });

  test("sameFileId: dev/ino/size/mtimeMs must all match", () => {
    const id = { dev: 7, ino: 3, size: 9, mtimeMs: 1000 };
    expect(sameFileId(id, { ...id })).toBe(true);
    expect(sameFileId(id, { ...id, size: 10 })).toBe(false);
    expect(sameFileId(id, { ...id, mtimeMs: 1001 })).toBe(false);
    expect(sameFileId(id, { ...id, ino: 4 })).toBe(false);
  });

  test("isOwnershipSafe: owner is self or root, no group/other write", () => {
    expect(isOwnershipSafe({ uid: 1000, mode: 0o755 }, 1000)).toBe(true);
    expect(isOwnershipSafe({ uid: 0, mode: 0o755 }, 1000)).toBe(true);
    expect(isOwnershipSafe({ uid: 999, mode: 0o755 }, 1000)).toBe(false);
    expect(isOwnershipSafe({ uid: 1000, mode: 0o775 }, 1000)).toBe(false);
    expect(isOwnershipSafe({ uid: 1000, mode: 0o757 }, 1000)).toBe(false);
  });
});

describe("WP28 followPinUpdate (Claude/Codex successor)", () => {
  const PIN = "/home/u/.local/bin/claude";
  const OLD = "/home/u/.local/share/claude/versions/2.1.100";
  const NEW = "/home/u/.local/share/claude/versions/2.1.200";
  const pin = { path: PIN, realpath: OLD };

  test("① a moved entry with a clean file verifies and returns the candidate (one streamed hash)", async () => {
    const io = fakeIo(PIN, NEW, { [NEW]: "new-binary" });
    io.versions.set(NEW, NEW_VERSION);
    const got = await followPinUpdate(pin, io);
    expect(got).toEqual({ realpath: NEW, sha256: sha("new-binary"), version: NEW_VERSION });
    expect(io.versionCalls).toEqual([NEW]);
    expect(io.sha256Calls).toEqual([NEW]);
  });

  test("② no successor (same target) ⇒ null, `--version` is never run", async () => {
    const io = fakeIo(PIN, OLD, { [OLD]: "old-binary" });
    expect(await followPinUpdate(pin, io)).toBeNull();
    expect(io.versionCalls).toEqual([]);
  });

  test("② entry gone ⇒ null", async () => {
    const io = fakeIo(PIN, null, {});
    expect(await followPinUpdate(pin, io)).toBeNull();
  });

  test("③ bad owner / group-writable ⇒ null, nothing verified", async () => {
    const io = fakeIo(PIN, NEW, { [NEW]: "new-binary" }, { ownership: () => ({ uid: 999, mode: 0o755 }) });
    io.versions.set(NEW, NEW_VERSION);
    expect(await followPinUpdate(pin, io)).toBeNull();
    const io2 = fakeIo(PIN, NEW, { [NEW]: "new-binary" }, { ownership: () => ({ uid: 1000, mode: 0o775 }) });
    io2.versions.set(NEW, NEW_VERSION);
    expect(await followPinUpdate(pin, io2)).toBeNull();
  });

  test("④ outside the approved entry (workspace / tmp / .venv) ⇒ null", async () => {
    for (const bad of ["/home/u/work/repo/claude", "/tmp/claude-new", "/home/u/w/.venv/bin/codex"]) {
      const io = fakeIo(PIN, bad, { [bad]: "x" }, { workspaceRoots: ["/home/u/work/repo"] });
      io.versions.set(bad, NEW_VERSION);
      expect(await followPinUpdate(pin, io)).toBeNull();
    }
  });

  test("⑤ `--version` failure / dirty output ⇒ null", async () => {
    const io = fakeIo(PIN, NEW, { [NEW]: "new-binary" });
    expect(await followPinUpdate(pin, io)).toBeNull(); // probe failed
    io.versions.set(NEW, "bad\nline");
    expect(await followPinUpdate(pin, io)).toBeNull();
  });

  test("⑤ changed during verification (`fileId` moves across `--version`) ⇒ null before any hash", async () => {
    const io = fakeIo(PIN, NEW, { [NEW]: "new-binary" });
    io.versions.set(NEW, NEW_VERSION);
    const first = io.fileId(NEW)!;
    let n = 0;
    io.fileId = () => (n++ === 0 ? first : { ...first, mtimeMs: 2000 });
    expect(await followPinUpdate(pin, io)).toBeNull();
    expect(io.versionCalls).toEqual([NEW]);
    expect(io.sha256Calls).toEqual([]);
  });

  test("Windows never follows", async () => {
    const io = fakeIo(PIN, NEW, { [NEW]: "new-binary" }, { platform: "win32" });
    io.versions.set(NEW, NEW_VERSION);
    expect(await followPinUpdate(pin, io)).toBeNull();
  });
});

describe("WP28 followMuseUpdate (marker successor)", () => {
  const DIR = "/home/u/.local/bin";
  const OLD_BIN = `${DIR}/muse-bin-1.4.6-R6000.1`;
  const NEW_BIN = `${DIR}/muse-bin-1.4.7-R6101.1`;

  test("① marker names a clean successor ⇒ verified candidate, no hash, marker version kept", async () => {
    const io = fakeIo(NEW_BIN, NEW_BIN, { [`${DIR}/.muse-version`]: "1.4.7-R6101.1\n", [NEW_BIN]: "muse-new" });
    // the real `--version` line carries its own format; the result keeps the marker's `<ver>`
    io.versions.set(NEW_BIN, "Muse Code 1.4.7 (1.4.7-R6101.1)");
    expect(await followMuseUpdate(OLD_BIN, io)).toEqual({ path: NEW_BIN, realpath: NEW_BIN, version: "1.4.7-R6101.1" });
    expect(io.versionCalls).toEqual([NEW_BIN]);
    expect(io.sha256Calls).toEqual([]);
  });

  test("① `fileId` moves across `--version` ⇒ null", async () => {
    const io = fakeIo(NEW_BIN, NEW_BIN, { [`${DIR}/.muse-version`]: "1.4.7-R6101.1\n", [NEW_BIN]: "muse-new" });
    io.versions.set(NEW_BIN, "Muse Code 1.4.7 (1.4.7-R6101.1)");
    const first = io.fileId(NEW_BIN)!;
    let n = 0;
    io.fileId = () => (n++ === 0 ? first : { ...first, size: 999 });
    expect(await followMuseUpdate(OLD_BIN, io)).toBeNull();
  });

  test("② no marker / same version ⇒ null", async () => {
    expect(await followMuseUpdate(OLD_BIN, fakeIo(NEW_BIN, NEW_BIN, {}))).toBeNull();
    const same = fakeIo(OLD_BIN, OLD_BIN, { [`${DIR}/.muse-version`]: "1.4.6-R6000.1", [OLD_BIN]: "x" });
    expect(await followMuseUpdate(OLD_BIN, same)).toBeNull();
  });

  test("③–⑤ bad owner / outside entry / `--version` failure ⇒ null", async () => {
    const base = { [`${DIR}/.muse-version`]: "1.4.7-R6101.1", [NEW_BIN]: "muse-new" };
    const badOwn = fakeIo(NEW_BIN, NEW_BIN, base, { ownership: () => ({ uid: 999, mode: 0o755 }) });
    badOwn.versions.set(NEW_BIN, "1.4.7-R6101.1");
    expect(await followMuseUpdate(OLD_BIN, badOwn)).toBeNull();
    const noVer = fakeIo(NEW_BIN, NEW_BIN, base);
    expect(await followMuseUpdate(OLD_BIN, noVer)).toBeNull();
    const evil = fakeIo("/tmp/m/muse-bin-9", "/tmp/m/muse-bin-9", { "/tmp/m/.muse-version": "9", "/tmp/m/muse-bin-9": "x" });
    expect(await followMuseUpdate("/tmp/m/muse-bin-8", evil)).toBeNull();
  });
});

const HELP =
  "Usage: claude\n  -p, --print  x\n  --output-format --input-format --verbose --include-partial-messages --model --effort --tools --allowedTools --permission-mode --setting-sources --strict-mcp-config --disable-slash-commands --restricted --no-session-persistence --resume --json-schema --max-budget-usd --system-prompt[-file] --permission-prompts --session-id\n";
const AUTH = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" });

function claudeProbes(version: string, help = HELP) {
  return createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: [version] })
    .script((s) => s.argv[0] === "auth", { stdout: [AUTH] })
    .script((s) => s.argv[0] === "--help", { stdout: help.split("\n") });
}

const MUSE_REST = [
  "exec",
  "--json",
  "--model",
  "{model}",
  "--reasoning-effort",
  "{effort}",
  "--prompt-file",
  "{promptFile}",
  "--workspace",
  "{emptyCwd}",
  "--worktree",
  "off",
  "--disable-shell",
  "--disable-write",
  "--disable-web-tools",
  "--no-foreign-personal-context",
  "--no-session-log",
  "--max-model-steps",
  "1",
  "--approval-mode",
  "untrusted",
  "--approval-judge",
  "off",
];

describe("WP28 engine detect: auto-follow", () => {
  test("Claude ① follows a moved symlink: saves by=auto-update, keeps the entry, reports followed + one log line", async () => {
    const persisted: BinaryPin[] = [];
    const b = createTestBridge({
      spawner: claudeProbes(NEW_VERSION),
      settings: (x) => {
        x.pins.claude = {
          path: "/home/u/.local/bin/claude",
          realpath: "/home/u/.local/share/claude/versions/2.1.100",
          sha256: sha("old-binary"),
          version: OLD_VERSION,
          pinnedAt: "2026-10-01T00:00:00.000Z",
          by: "user",
        };
      },
      pin: async (_engine, pin) => {
        persisted.push(pin);
      },
      follow: {},
    });
    b.fs.files.set("/home/u/.local/bin/claude", enc.encode("new-binary"));
    const s = await b.engines["claude-cli"]?.detect();
    expect(s?.installed).toBe(true);
    expect(s?.problems).toEqual([]);
    expect(s?.pin).toMatchObject({ path: "/home/u/.local/bin/claude", version: NEW_VERSION, by: "auto-update", previousVersion: OLD_VERSION });
    expect(s?.pin?.sha256).toBe(sha("new-binary"));
    expect(s?.followed?.from).toBe(OLD_VERSION);
    expect(s?.followed?.to).toBe(NEW_VERSION);
    expect(persisted).toHaveLength(1);
    expect(b.log.lines.filter((l) => l.msg === "agent.claude.auto_follow")).toHaveLength(1);
    // WP28b: the pin hash is streamed exactly once per follow
    expect(b.followSpy.sha256Calls).toEqual(["/home/u/.local/bin/claude"]);
  });

  test("Claude WP28b: a failed candidate is not re-probed; a changed candidate is tried again", async () => {
    const spawner = claudeProbes(NEW_VERSION);
    const versionSpawns = () => spawner.calls.filter((c) => c.argv[0] === "--version").length;
    const b = createTestBridge({
      spawner,
      settings: (x) => {
        x.pins.claude = {
          path: "/home/u/.local/bin/claude",
          realpath: "/home/u/.local/share/claude/versions/2.1.100",
          sha256: sha("old-binary"),
          version: OLD_VERSION,
          pinnedAt: "2026-10-01T00:00:00.000Z",
          by: "user",
        };
      },
      // the hash stream fails: verification reaches `--version`, then refuses the candidate
      follow: { sha256File: async () => null },
    });
    b.fs.files.set("/home/u/.local/bin/claude", enc.encode("new-binary"));
    const first = await b.engines["claude-cli"]?.detect();
    expect(first?.problems.map((p) => p.code)).toContain("E_ENGINE_BINARY_CHANGED");
    expect(first?.followed).toBeUndefined();
    expect(versionSpawns()).toBe(2); // the probe's and the follow's
    expect(b.followSpy.sha256Calls).toHaveLength(1);
    // same candidate: the follow probe is skipped, only the status probe runs
    const second = await b.engines["claude-cli"]?.detect();
    expect(second?.problems.map((p) => p.code)).toContain("E_ENGINE_BINARY_CHANGED");
    expect(versionSpawns()).toBe(3);
    expect(b.followSpy.sha256Calls).toHaveLength(1);
    // changed candidate (another size ⇒ another identity): tried again, still refused
    b.fs.files.set("/home/u/.local/bin/claude", enc.encode("new-binary-v2!!"));
    const third = await b.engines["claude-cli"]?.detect();
    expect(third?.problems.map((p) => p.code)).toContain("E_ENGINE_BINARY_CHANGED");
    expect(versionSpawns()).toBe(5);
    expect(b.followSpy.sha256Calls).toHaveLength(2);
  });

  test("Claude without follow ports keeps E_ENGINE_BINARY_CHANGED and saves nothing (§B)", async () => {
    const persisted: BinaryPin[] = [];
    const b = createTestBridge({
      spawner: claudeProbes(NEW_VERSION),
      settings: (x) => {
        x.pins.claude = {
          path: "/home/u/.local/bin/claude",
          realpath: "/home/u/.local/share/claude/versions/2.1.100",
          sha256: sha("old-binary"),
          version: OLD_VERSION,
          pinnedAt: "2026-10-01T00:00:00.000Z",
          by: "user",
        };
      },
      pin: async (_engine, pin) => {
        persisted.push(pin);
      },
    });
    b.fs.files.set("/home/u/.local/bin/claude", enc.encode("new-binary"));
    const s = await b.engines["claude-cli"]?.detect();
    expect(s?.problems.map((p) => p.code)).toContain("E_ENGINE_BINARY_CHANGED");
    expect(s?.followed).toBeUndefined();
    expect(persisted).toHaveLength(0);
  });

  test("Claude ③/⑤/⑥ bad owner, `--version` failure, capability loss ⇒ no save (§B)", async () => {
    const settings = (x: Settings) => {
      x.pins.claude = {
        path: "/home/u/.local/bin/claude",
        realpath: "/home/u/.local/share/claude/versions/2.1.100",
        sha256: sha("old-binary"),
        version: OLD_VERSION,
        pinnedAt: "2026-10-01T00:00:00.000Z",
        by: "user",
      };
    };
    // bad owner
    const badOwn: BinaryPin[] = [];
    const b1 = createTestBridge({
      spawner: claudeProbes(NEW_VERSION),
      settings,
      pin: async (_e, p) => {
        badOwn.push(p);
      },
      follow: { ownership: () => ({ uid: 999, mode: 0o755 }) },
    });
    b1.fs.files.set("/home/u/.local/bin/claude", enc.encode("new-binary"));
    expect((await b1.engines["claude-cli"]?.detect())?.problems.map((p) => p.code)).toContain("E_ENGINE_BINARY_CHANGED");
    expect(badOwn).toHaveLength(0);
    // capability loss in the new binary
    const badCap: BinaryPin[] = [];
    const b2 = createTestBridge({
      spawner: claudeProbes(NEW_VERSION, HELP.replace(" --restricted", "")),
      settings,
      pin: async (_e, p) => {
        badCap.push(p);
      },
      follow: {},
    });
    b2.fs.files.set("/home/u/.local/bin/claude", enc.encode("new-binary"));
    const s2 = await b2.engines["claude-cli"]?.detect();
    expect(s2?.problems.map((p) => p.code)).toContain("E_AGENT_CAPABILITY");
    expect(badCap).toHaveLength(0);
    expect(s2?.followed).toBeUndefined();
    // Windows never follows
    const win: BinaryPin[] = [];
    const b3 = createTestBridge({
      spawner: claudeProbes(NEW_VERSION),
      settings,
      pin: async (_e, p) => {
        win.push(p);
      },
      follow: { platform: "win32" },
    });
    b3.fs.files.set("/home/u/.local/bin/claude", enc.encode("new-binary"));
    expect((await b3.engines["claude-cli"]?.detect())?.problems.map((p) => p.code)).toContain("E_ENGINE_BINARY_CHANGED");
    expect(win).toHaveLength(0);
  });

  test("Codex ① follows a moved entry at the verified version; unverified versions keep human review", async () => {
    const codexSettings = (x: Settings) => {
      x.engines["codex-cli"] = {
        enabled: true,
        binary: "codex",
        model: "gpt-5-codex",
        pricing: { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0.1 },
        maxEstimatedSpendUsd: 0.1,
      };
      x.pins.codex = {
        path: "/home/u/.local/bin/codex",
        realpath: "/home/u/.local/share/codex/versions/0.159.0",
        sha256: sha("old-codex"),
        version: "codex-cli 0.159.0",
        pinnedAt: "2026-10-01T00:00:00.000Z",
        by: "user",
      };
    };
    const persisted: BinaryPin[] = [];
    const b = createTestBridge({
      spawner: createFakeSpawner().script((s) => s.argv[0] === "--version", { stdout: [`codex-cli ${CODEX_VERSION}`] }),
      settings: codexSettings,
      pin: async (_e, p) => {
        persisted.push(p);
      },
      follow: {},
    });
    b.fs.files.set("/home/u/.local/bin/codex", enc.encode("new-codex"));
    const s = await b.engines["codex-cli"]?.detect();
    expect(s?.problems.map((p) => p.code)).not.toContain("E_AGENT_CAPABILITY");
    expect(s?.pin?.by).toBe("auto-update");
    expect(s?.pin?.previousVersion).toBe("codex-cli 0.159.0");
    expect(s?.followed?.to).toBe(`codex-cli ${CODEX_VERSION}`);
    expect(persisted).toHaveLength(1);
    // WP28b: the pin hash is streamed exactly once per follow
    expect(b.followSpy.sha256Calls).toEqual(["/home/u/.local/bin/codex"]);
    // unverified version: no save, human review stays
    const bad: BinaryPin[] = [];
    const b2 = createTestBridge({
      spawner: createFakeSpawner().script((s) => s.argv[0] === "--version", { stdout: ["codex-cli 9.999.9"] }),
      settings: codexSettings,
      pin: async (_e, p) => {
        bad.push(p);
      },
      follow: {},
    });
    b2.fs.files.set("/home/u/.local/bin/codex", enc.encode("new-codex"));
    const s2 = await b2.engines["codex-cli"]?.detect();
    expect(s2?.problems.map((p) => p.code)).toContain("E_AGENT_CAPABILITY");
    expect(bad).toHaveLength(0);
    expect(s2?.followed).toBeUndefined();
  });

  test("Codex WP28b: a failed candidate is not re-probed; a changed candidate is tried again", async () => {
    const codexFailSettings = (x: Settings) => {
      x.engines["codex-cli"] = {
        enabled: true,
        binary: "codex",
        model: "gpt-5-codex",
        pricing: { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0.1 },
        maxEstimatedSpendUsd: 0.1,
      };
      x.pins.codex = {
        path: "/home/u/.local/bin/codex",
        realpath: "/home/u/.local/share/codex/versions/0.159.0",
        sha256: sha("old-codex"),
        version: "codex-cli 0.159.0",
        pinnedAt: "2026-10-01T00:00:00.000Z",
        by: "user",
      };
    };
    const spawner = createFakeSpawner().script((s) => s.argv[0] === "--version", { stdout: [`codex-cli ${CODEX_VERSION}`] });
    const versionSpawns = () => spawner.calls.filter((c) => c.argv[0] === "--version").length;
    const b = createTestBridge({
      spawner,
      settings: codexFailSettings,
      pin: async () => {},
      // the hash stream fails: verification reaches `--version`, then refuses the candidate
      follow: { sha256File: async () => null },
    });
    b.fs.files.set("/home/u/.local/bin/codex", enc.encode("new-codex"));
    const first = await b.engines["codex-cli"]?.detect();
    expect(first?.problems.map((p) => p.code)).toContain("E_AGENT_CAPABILITY");
    expect(first?.followed).toBeUndefined();
    expect(versionSpawns()).toBe(1);
    // same candidate: no new `--version` spawn at all
    const second = await b.engines["codex-cli"]?.detect();
    expect(second?.problems.map((p) => p.code)).toContain("E_AGENT_CAPABILITY");
    expect(versionSpawns()).toBe(1);
    // changed candidate (another size ⇒ another identity): tried again, still refused
    b.fs.files.set("/home/u/.local/bin/codex", enc.encode("new-codex-v2!!"));
    const third = await b.engines["codex-cli"]?.detect();
    expect(third?.problems.map((p) => p.code)).toContain("E_AGENT_CAPABILITY");
    expect(versionSpawns()).toBe(2);
  });

  test("Muse ① follows the marker successor: only argv[0] changes, followed is reported", async () => {
    const DIR = "/home/u/.local/bin";
    const OLD_BIN = `${DIR}/muse-bin-1.4.6-R6000.1`;
    const NEW_BIN = `${DIR}/muse-bin-1.4.7-R6101.1`;
    const b = createTestBridge({
      // the real `--version` line carries its own format; `followed` still uses the `muse-bin-<ver>` form
      spawner: createFakeSpawner().script((s) => s.argv[0] === "--version", { stdout: ["Muse Code 1.4.7 (1.4.7-R6101.1)"] }),
      settings: (x) => {
        x.engines.generic = { enabled: true, argv: [OLD_BIN, ...MUSE_REST], protocol: "muse-jsonl" };
      },
      follow: {},
    });
    b.fs.files.set(`${DIR}/.muse-version`, enc.encode("1.4.7-R6101.1\n"));
    b.fs.files.set(NEW_BIN, enc.encode("muse-new"));
    const s = await b.engines.generic?.detect();
    expect(s?.installed).toBe(true);
    expect(s?.problems).toEqual([]);
    expect(s?.path).toBe(NEW_BIN);
    expect(s?.followed).toEqual({ from: "1.4.6-R6000.1", to: "1.4.7-R6101.1", at: expect.any(String) });
    expect(b.log.lines.filter((l) => l.msg === "agent.generic.auto_follow")).toHaveLength(1);
    // WP28b: Muse takes no hash
    expect(b.followSpy.sha256Calls).toEqual([]);
  });

  test("Muse WP28b: a failed candidate is not re-probed; a changed candidate is tried again", async () => {
    const DIR = "/home/u/.local/bin";
    const OLD_BIN = `${DIR}/muse-bin-1.4.6-R6000.1`;
    const NEW_BIN = `${DIR}/muse-bin-1.4.7-R6101.1`;
    // no `--version` script: the follow probe fails and the candidate is refused
    const spawner = createFakeSpawner();
    const versionSpawns = () => spawner.calls.filter((c) => c.argv[0] === "--version").length;
    const b = createTestBridge({
      spawner,
      settings: (x) => {
        x.engines.generic = { enabled: true, argv: [OLD_BIN, ...MUSE_REST], protocol: "muse-jsonl" };
      },
      follow: {},
    });
    b.fs.files.set(`${DIR}/.muse-version`, enc.encode("1.4.7-R6101.1\n"));
    b.fs.files.set(NEW_BIN, enc.encode("muse-new"));
    const first = await b.engines.generic?.detect();
    expect(first?.installed).toBe(false);
    expect(first?.problems.map((p) => p.code)).toContain("E_AGENT_NOT_INSTALLED");
    expect(versionSpawns()).toBe(1);
    // same marker + candidate: no new `--version` spawn
    const second = await b.engines.generic?.detect();
    expect(second?.problems.map((p) => p.code)).toContain("E_AGENT_NOT_INSTALLED");
    expect(versionSpawns()).toBe(1);
    expect(b.followSpy.sha256Calls).toEqual([]);
    // changed candidate (another size ⇒ another identity): tried again, still refused
    b.fs.files.set(NEW_BIN, enc.encode("muse-new-v2!!"));
    const third = await b.engines.generic?.detect();
    expect(third?.problems.map((p) => p.code)).toContain("E_AGENT_NOT_INSTALLED");
    expect(versionSpawns()).toBe(2);
  });

  test("Muse ② no successor keeps the gone-binary status and saves nothing (§B)", async () => {
    const OLD_BIN = "/home/u/.local/bin/muse-bin-1.4.6-R6000.1";
    const b = createTestBridge({
      spawner: createFakeSpawner(),
      settings: (x) => {
        x.engines.generic = { enabled: true, argv: [OLD_BIN, ...MUSE_REST], protocol: "muse-jsonl" };
      },
      follow: {},
    });
    const s = await b.engines.generic?.detect();
    expect(s?.installed).toBe(false);
    expect(s?.problems.map((p) => p.code)).toContain("E_AGENT_NOT_INSTALLED");
    expect(s?.followed).toBeUndefined();
  });
});
