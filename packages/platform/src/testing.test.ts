import { describe, expect, test } from "bun:test";
import { MitoriError } from "@mitori/core";
import { gitBlobOid } from "./hash/digest.ts";
import type { SpawnSpec } from "./spawn/types.ts";
import { createFakeClock, createFakeSpawner, memDb, memGitReader } from "./testing.ts";

const spec = (command: string, argv: string[] = []): SpawnSpec => ({
  command,
  argv,
  env: {},
  cwd: "/",
  stdin: "",
  keepStdinOpen: false,
  timeoutMs: 0,
  processGroup: false,
});
const drain = async (it: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const l of it) out.push(l);
  return out;
};

describe("@mitori/platform/testing fakes", () => {
  test("FakeClock: starts at 2026-01-01, fires timers in due order on advance/set, clearTimeout", () => {
    const c = createFakeClock();
    expect(c.iso()).toBe("2026-01-01T00:00:00.000Z");
    const fired: string[] = [];
    c.setTimeout(() => fired.push("b"), 20);
    c.setTimeout(() => fired.push("a"), 10);
    const x = c.setTimeout(() => fired.push("x"), 15);
    c.setTimeout(() => {
      fired.push("c");
      c.setTimeout(() => fired.push("nested"), 1);
    }, 20);
    c.clearTimeout(x);
    c.advance(19);
    expect(fired).toEqual(["a"]);
    c.advance(5);
    expect(fired).toEqual(["a", "b", "c", "nested"]);
    expect(c.now()).toBe(Date.parse("2026-01-01T00:00:00.024Z"));
    c.set("2026-02-01T00:00:00.000Z");
    expect(c.iso()).toBe("2026-02-01T00:00:00.000Z");
    expect(createFakeClock("2026-05-05T00:00:00.000Z").now()).toBe(Date.parse("2026-05-05T00:00:00.000Z"));
  });

  test("FakeSpawner: scripted output, exit code, delay on the fake clock, hang until kill, unmatched throws", async () => {
    const clock = createFakeClock();
    const sp = createFakeSpawner({ clock })
      .script((s) => s.command === "git", { stdout: ["a", "b"], stderr: ["warn"], exitCode: 3, delayMs: 50 })
      .script(
        (s) => s.command === "claude",
        (s) => ({ stdout: [s.argv.join(" ")], hang: true }),
      );
    const g = sp.spawn(spec("git", ["status"]));
    let done = false;
    void g.exited.then(() => {
      done = true;
    });
    await Bun.sleep(1);
    expect(done).toBe(false);
    clock.advance(50);
    expect(await g.exited).toBe(3);
    expect(await drain(g.stdout)).toEqual(["a", "b"]);
    expect(await drain(g.stderr)).toEqual(["warn"]);
    const c = sp.spawn(spec("claude", ["-p", "x"]));
    clock.advance(0);
    const it = c.stdout[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe("-p x");
    c.kill("SIGINT");
    expect(await c.exited).toBe(130);
    expect(sp.calls.map((s) => s.command)).toEqual(["git", "claude"]);
    expect(() => sp.spawn(spec("rm", ["-rf", "/"]))).toThrow(MitoriError);
  });

  test("memDb applies migrations in package order of appearance, versions ascending", () => {
    const db = memDb([
      { pkg: "@mitori/doc", db: "workspace", version: 2, up: "ALTER TABLE doc_x ADD COLUMN b TEXT" },
      { pkg: "@mitori/doc", db: "workspace", version: 1, up: "CREATE TABLE doc_x (a TEXT)" },
    ]);
    db.run("INSERT INTO doc_x VALUES ($a, $b)", { a: "1", b: "2" });
    expect(db.get<{ b: string }>("SELECT b FROM doc_x")?.b).toBe("2");
    expect(() =>
      memDb([
        { pkg: "@mitori/doc", db: "workspace", version: 1, up: "" },
        { pkg: "@mitori/agent", db: "state", version: 1, up: "" },
      ]),
    ).toThrow();
  });

  test("memGitReader: real sha1 blob ids, catBlob, defaults", async () => {
    const g = memGitReader({ "b.ts": "b", "a.ts": new TextEncoder().encode("a") }, { head: "f".repeat(40), branch: "main" });
    const files = await g.lsFiles();
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(files[1]?.blob).toBe(gitBlobOid(new TextEncoder().encode("b"), "sha1"));
    expect(new TextDecoder().decode(await g.catBlob(files[0]?.blob as string))).toBe("a");
    expect(await g.head()).toBe("f".repeat(40));
    expect(await g.branch()).toBe("main");
    expect(await g.objectFormat()).toBe("sha1");
    await expect(g.catBlob("0".repeat(40))).rejects.toThrow(MitoriError);
  });
});
