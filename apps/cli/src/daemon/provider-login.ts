/** The browser can open a visible terminal for one fixed, human-confirmed CLI sign-in command. */
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { PROVIDER_AUTH_IDS, type ProviderAuthId, type ProviderLoginRes } from "@mitori/core";
import type { createSpawner } from "@mitori/platform";

type Spawner = ReturnType<typeof createSpawner>;
type SpawnSpec = Parameters<Spawner["spawn"]>[0];

interface LoginOptions {
  launcher: { command: string; args: string[] };
  home: string;
  userHome: string;
  safePath: string;
  env: Readonly<Record<string, string | undefined>>;
}

type TerminalName = "osascript" | "gnome-terminal" | "konsole" | "xterm" | "x-terminal-emulator";
const LINUX_TERMINALS: readonly TerminalName[] = ["gnome-terminal", "konsole", "xterm", "x-terminal-emulator"];
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// Paths and selected environment values are host-owned; controls cannot become shell/AppleScript statements.
// biome-ignore lint/suspicious/noControlCharactersInRegex: reject controls in host invocation metadata
const CONTROL = /[\u0000-\u001f\u007f]/;

function systemCommand(name: TerminalName): string | null {
  try {
    const path = realpathSync(`/usr/bin/${name}`);
    const stat = statSync(path);
    return stat.isFile() && stat.uid === 0 && (stat.mode & 0o022) === 0 && (stat.mode & 0o111) !== 0 && /^\/(?:usr\/|bin\/|System\/)/.test(path) ? path : null;
  } catch {
    return null;
  }
}

function canonicalLauncher(launcher: LoginOptions["launcher"]): LoginOptions["launcher"] | null {
  if (launcher.args.length > 1 || [launcher.command, ...launcher.args].some((v) => !isAbsolute(v) || CONTROL.test(v))) return null;
  try {
    const values = [launcher.command, ...launcher.args].map((v) => realpathSync(v));
    if (values.some((v) => !statSync(v).isFile())) return null;
    return { command: values[0] as string, args: values.slice(1) };
  } catch {
    return null;
  }
}

/** Pure fixed-argv planning, also exercised for the Linux branch without opening any terminal. */
export function providerLoginSpawnSpec(options: LoginOptions, provider: ProviderAuthId, terminal: { name: TerminalName; path: string }): SpawnSpec {
  if (!(PROVIDER_AUTH_IDS as readonly string[]).includes(provider)) throw new Error("unsupported provider");
  const authEnv: Record<string, string> = { HOME: options.userHome, PATH: options.safePath, MITORI_HOME: options.home };
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE", "TERM", "USER", "LOGNAME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"])
    if (options.env[name] && !CONTROL.test(options.env[name])) authEnv[name] = options.env[name];
  for (const name of ["XDG_CONFIG_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"])
    if (options.env[name] && isAbsolute(options.env[name]) && !CONTROL.test(options.env[name])) authEnv[name] = options.env[name];
  const invocation = [
    "/usr/bin/env",
    "-i",
    ...Object.entries(authEnv).map(([k, v]) => `${k}=${v}`),
    options.launcher.command,
    ...options.launcher.args,
    "auth",
    provider,
  ];
  const env: Record<string, string> = { HOME: options.userHome, PATH: options.safePath };
  for (const name of ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME"])
    if (options.env[name] && !CONTROL.test(options.env[name])) env[name] = options.env[name];
  let argv: string[];
  if (terminal.name === "osascript") {
    const shell = `cd '/' && exec ${invocation.map(quote).join(" ")}`;
    const literal = `"${shell.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    argv = ["-e", `tell application "Terminal"\nactivate\ndo script ${literal}\nend tell`];
  } else if (terminal.name === "gnome-terminal") argv = ["--working-directory=/", "--", ...invocation];
  else if (terminal.name === "konsole") argv = ["--workdir", "/", "-e", ...invocation];
  else argv = ["-e", ...invocation];
  return { command: terminal.path, argv, env, cwd: "/", stdin: "", keepStdinOpen: false, timeoutMs: 0, processGroup: true };
}

/** Dispatch only mitori's own `auth <provider>`; provider binaries are reviewed later on the human TTY. */
export function createProviderLoginOpener(
  options: LoginOptions & { spawner: Spawner; platform?: NodeJS.Platform },
): (provider: ProviderAuthId) => Promise<ProviderLoginRes> {
  const platform = options.platform ?? process.platform;
  return async (provider) => {
    const launcher = canonicalLauncher(options.launcher);
    if (!launcher || [options.home, options.userHome, options.safePath].some((v) => CONTROL.test(v))) return { opened: false };
    const names =
      platform === "darwin" ? ["osascript" as const] : platform === "linux" && (options.env.DISPLAY || options.env.WAYLAND_DISPLAY) ? LINUX_TERMINALS : [];
    const terminal = names.map((name) => ({ name, path: systemCommand(name) })).find((t): t is { name: TerminalName; path: string } => t.path !== null);
    if (!terminal) return { opened: false };
    try {
      const child = options.spawner.spawn(providerLoginSpawnSpec({ ...options, launcher }, provider, terminal));
      // Terminal/opener output can contain account details: discard it, never return or log it.
      for (const stream of [child.stdout, child.stderr])
        void (async () => {
          for await (const _ of stream) {
            /* discard */
          }
        })().catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A desktop terminal may stay alive until the login finishes. "opened" means dispatch only.
        const code = await Promise.race([
          child.exited,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 250);
          }),
        ]);
        return { opened: code === null || code === 0 };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    } catch {
      return { opened: false };
    }
  };
}
