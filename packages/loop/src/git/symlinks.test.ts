// F1 remainder: which tracked symlinks a job worktree never materializes (pure decision; git.int.test.ts runs it on
// a real repository).
import { describe, expect, test } from "bun:test";
import type { RepoPath } from "@mitori/core";
import { escapingSymlinks } from "./worktree.ts";

const links = (o: Record<string, string>) => new Map(Object.entries(o) as [RepoPath, string][]);

describe("escapingSymlinks", () => {
  test("absolute, climbing and .git targets escape; links that stay inside the tree do not", () => {
    expect(
      escapingSymlinks(
        links({
          abs: "/Users/u/.aws/credentials",
          climb: "../outside",
          "a/b/deep": "../../../x",
          "a/b/ok": "../../README.md",
          gitcfg: ".git/config",
          "docs/gitdir": "../.git",
          inside: "README.md",
          dot: "./src/main.go",
        }),
      ),
    ).toEqual(["a/b/deep", "abs", "climb", "docs/gitdir", "gitcfg"]);
  });

  test("a link that reaches an escaping link (directly or as a directory prefix) escapes too; loops never materialize", () => {
    expect(
      escapingSymlinks(links({ chain: "abs", abs: "/etc/hosts", "via/dir": "../linked/file", linked: "/tmp", fine: "inside", inside: "README.md" })),
    ).toEqual(["abs", "chain", "linked", "via/dir"]);
    expect(escapingSymlinks(links({ a: "b", b: "a" }))).toEqual(["a", "b"]);
  });
});
