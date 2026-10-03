/**
 * `mitori export --html -o <target>` (WP-13): where the file lands. The command itself (body, summary line, SafeWriter)
 * is covered in commands.test.ts and against the real daemon in e2e/export/export.int.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./index.ts";
import { type FakeDaemon, startFakeDaemon, testIo } from "./test/fake-daemon.ts";

let d: FakeDaemon;
beforeEach(async () => {
  d = await startFakeDaemon();
  d.route("POST /ws/:ws/export", () => ({
    html: "<!doctype html><title>doc</title>",
    bytes: 1024,
    sha256: "ef".repeat(32),
    redactions: 0,
    codeExcerpts: { count: 1, files: 1 },
  }));
});
afterEach(() => d.cleanup());
const io = (argv: string[]) => testIo({ argv, home: d.home, cwd: d.repo });

describe("WP13-CLI-01 export -o", () => {
  test("no -o: <workspace>.mitori.html in the current directory", async () => {
    const t = io(["--html"]);
    expect(await runCommand("export", t)).toBe(0);
    expect(readFileSync(join(d.repo, "repo.mitori.html"), "utf8")).toContain("<title>doc</title>");
    expect(t.stdout).toBe(`${join(realpathSync(d.repo), "repo.mitori.html")}\n`);
  });

  test("-o <an existing directory> puts the file in it under its usual name instead of failing on the directory", async () => {
    mkdirSync(join(d.repo, "share"));
    const t = io(["--html", "-o", "share"]);
    expect(await runCommand("export", t)).toBe(0);
    expect(readFileSync(join(d.repo, "share", "repo.mitori.html"), "utf8")).toContain("<title>doc</title>");
    expect(t.stdout).toBe(`${join(realpathSync(d.repo), "share", "repo.mitori.html")}\n`);
  });

  test("-o <dir>/ (trailing slash) means the same; a directory that does not exist is an error, nothing is written", async () => {
    mkdirSync(join(d.repo, "out"));
    expect(await runCommand("export", io(["--html", "-o", "out/"]))).toBe(0);
    expect(existsSync(join(d.repo, "out", "repo.mitori.html"))).toBe(true);
    const t = io(["--html", "-o", "missing/"]);
    expect(await runCommand("export", t)).not.toBe(0);
    expect(t.stderr).toContain("no such directory");
    expect(existsSync(join(d.repo, "missing"))).toBe(false);
  });

  test("-o <file> is that file", async () => {
    mkdirSync(join(d.repo, "docs"));
    expect(await runCommand("export", io(["--html", "-o", "docs/design.html"]))).toBe(0);
    expect(readFileSync(join(d.repo, "docs", "design.html"), "utf8")).toContain("<title>doc</title>");
  });
});
