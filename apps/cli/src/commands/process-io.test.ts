import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { spawnOfficialLogin } from "./process-io.ts";

test("official auth inherits the terminal in an empty temporary directory and cleans up on both exit and failure", async () => {
  const spec = {
    cmd: ["/official/claude", "auth", "login"],
    env: { HOME: "/user-home", PATH: "/usr/bin:/bin" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  } as const;
  for (const fails of [false, true]) {
    let cwd = "";
    const run = spawnOfficialLogin({ ...spec, cmd: [...spec.cmd] }, async (native) => {
      cwd = native.cwd;
      expect(readdirSync(cwd)).toEqual([]);
      expect(native).toEqual({ ...spec, cmd: [...spec.cmd], cwd });
      if (fails) throw new Error("native start failed");
      return 17;
    });
    if (fails) await expect(run).rejects.toThrow("native start failed");
    else expect(await run).toBe(17);
    expect(cwd).not.toBe("");
    expect(existsSync(cwd)).toBe(false);
  }
});
