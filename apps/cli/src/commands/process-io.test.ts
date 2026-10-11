import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { daemonStartupPid, spawnOfficialLogin } from "./process-io.ts";

test("the private startup pipe supplies the real daemon PID; absent, malformed or late acknowledgements confer no ownership", async () => {
  const pending = new Promise<never>(() => {});
  for (const [line, expected] of [
    ["mitori-daemon-pid 12345", 12345],
    ["mitori-daemon-pid 0", 0],
    ["mitori-daemon-pid -1", 0],
    ["mitori-daemon-pid 9007199254740992", 0],
    ["mitori-daemon-pid 12345 extra", 0],
    ["unexpected output", 0],
    [undefined, 0],
  ] as const) {
    const stdout = (async function* () {
      if (line !== undefined) yield line;
    })();
    if (expected > 0) expect(await daemonStartupPid({ stdout, exited: pending }, 0)).toBe(0);
    expect(await daemonStartupPid({ stdout, exited: pending }, 100)).toBe(expected);
  }
  for (const exited of [pending, Promise.resolve(0)]) {
    const stdout = (async function* () {
      await pending;
      yield "mitori-daemon-pid 12345";
    })();
    expect(await daemonStartupPid({ stdout, exited }, 10)).toBe(0);
  }
}, 1000);

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
