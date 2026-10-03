import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { versionLine } from "./main.ts";

describe("CLI-U-000 mitori entry", () => {
  test("prints name, package version and API version", () => {
    expect(versionLine()).toBe(`mitori ${pkg.version} (api 1)`);
  });

  test("the entry runs as a script; usage errors exit 2", () => {
    const run = (...args: string[]) => Bun.spawnSync(["bun", `${import.meta.dir}/main.ts`, ...args], { stderr: "pipe" });
    const r = run("--version");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe(`${versionLine()}\n`);
    expect(run("--help").exitCode).toBe(0);
    expect(run("bogus").exitCode).toBe(2); // not a directory
    expect(run("--bogus").exitCode).toBe(2);
    expect(run(import.meta.dir, "--no-such-flag").exitCode).toBe(2);
    expect(run("_serve", "--port", "70000").exitCode).toBe(2);
  });
});
