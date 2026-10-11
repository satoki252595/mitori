import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { versionLine } from "./main.ts";

describe("CLI-U-000 mitori entry", () => {
  test("prints name, package version and API version", () => {
    expect(versionLine()).toBe(`mitori ${pkg.version} (api 1)`);
  });

  test("main help lists the public commands in the selected language", () => {
    for (const [lang, heading] of [
      ["ja", "使い方:"],
      ["en", "usage:"],
    ] as const) {
      const r = Bun.spawnSync(["bun", `${import.meta.dir}/main.ts`, "--help"], {
        env: { ...process.env, MITORI_LANG: lang },
        stderr: "pipe",
      });
      expect(r.exitCode).toBe(0);
      const help = r.stderr.toString();
      expect(help).toContain(heading);
      for (const command of ["setup", "auth", "review", "gen", "export", "stop"]) expect(help).toContain(`mitori ${command}`);
      expect(help).not.toContain("walking skeleton");
    }
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
