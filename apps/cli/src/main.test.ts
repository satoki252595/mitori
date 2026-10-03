import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { versionLine } from "./main.ts";

describe("CLI-U-000 mitori --version (M0 hello)", () => {
  test("prints name, package version and API version", () => {
    expect(versionLine()).toBe(`mitori ${pkg.version} (api 1)`);
  });

  test("the entry runs as a script", () => {
    const r = Bun.spawnSync(["bun", `${import.meta.dir}/main.ts`, "--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe(`${versionLine()}\n`);
    expect(Bun.spawnSync(["bun", `${import.meta.dir}/main.ts`, "bogus"]).exitCode).toBe(2);
  });
});
