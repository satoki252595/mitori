import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSpawner } from "@mitori/platform/testing";
import { createProviderLoginOpener, providerLoginSpawnSpec } from "./provider-login.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("macOS terminal quoting survives both AppleScript and shell without credentials, target cwd, or extra commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mitori login ' $ "));
  dirs.push(dir);
  const source = join(dir, "entry ' $().ts");
  const userHome = `${dir}/user ' \\ $()`;
  writeFileSync(source, "console.log(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),env:process.env}));");
  const spec = providerLoginSpawnSpec(
    {
      launcher: { command: process.execPath, args: [source] },
      home: dir,
      userHome,
      safePath: "/usr/bin:/bin",
      env: {
        ANTHROPIC_API_KEY: "secret-never-pass",
        CODEX_API_KEY: "secret-never-pass",
        CLAUDECODE: "1",
        LANG: "en_US.UTF-8",
        CLAUDE_CONFIG_DIR: `${userHome}/claude`,
        CODEX_HOME: "relative-must-not-pass",
      },
    },
    "claude",
    { name: "osascript", path: "/usr/bin/osascript" },
  );
  expect(spec.command).toBe("/usr/bin/osascript");
  expect(spec.cwd).toBe("/");
  expect(JSON.stringify(spec)).not.toContain("secret-never-pass");
  const literal = /do script "(.*)"\nend tell/.exec(spec.argv[1] ?? "")?.[1];
  expect(literal).toBeDefined();
  const shell = (literal as string).replace(/\\([\\"])/g, "$1");
  // This is a fixture printing argv/env, never the auth command or a provider executable.
  const proc = Bun.spawn(["/bin/sh", "-c", shell], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  expect({ code: await proc.exited, stderr: await new Response(proc.stderr).text() }).toEqual({ code: 0, stderr: "" });
  const result = JSON.parse(output);
  expect(result.argv).toEqual(["auth", "claude"]);
  expect(result.cwd).toBe("/");
  expect(result.env.HOME).toBe(userHome);
  expect(result.env.MITORI_HOME).toBe(dir);
  expect(result.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(result.env.CLAUDECODE).toBeUndefined();
  expect(result.env.CLAUDE_CONFIG_DIR).toBe(`${userHome}/claude`);
  expect(result.env.CODEX_HOME).toBeUndefined();
});

test("Linux terminal plans use fixed argv with neutral cwd; unsupported/headless hosts never spawn", async () => {
  const spawner = createFakeSpawner();
  const options = {
    launcher: { command: process.execPath, args: [import.meta.path] },
    home: "/mitori",
    userHome: "/user",
    safePath: "/usr/bin:/bin",
    env: { DISPLAY: ":0", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus", API_KEY: "secret-never-pass" },
  };
  const spec = providerLoginSpawnSpec(options, "codex", { name: "gnome-terminal", path: "/usr/bin/gnome-terminal" });
  expect(spec.argv.slice(0, 4)).toEqual(["--working-directory=/", "--", "/usr/bin/env", "-i"]);
  expect(spec.argv.slice(-4)).toEqual([process.execPath, import.meta.path, "auth", "codex"]);
  expect(spec.cwd).toBe("/");
  expect(spec.env.DISPLAY).toBe(":0");
  expect(spec.argv).toContain("DISPLAY=:0");
  expect(spec.argv).toContain("DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1/bus");
  expect(JSON.stringify(spec)).not.toContain("secret-never-pass");
  expect(await createProviderLoginOpener({ ...options, spawner, platform: "win32" })("muse")).toEqual({ opened: false });
  expect(await createProviderLoginOpener({ ...options, env: {}, spawner, platform: "linux" })("muse")).toEqual({ opened: false });
  expect(await createProviderLoginOpener({ ...options, launcher: { command: "bun", args: [] }, spawner, platform: "darwin" })("muse")).toEqual({
    opened: false,
  });
  expect(spawner.calls).toEqual([]);
});
