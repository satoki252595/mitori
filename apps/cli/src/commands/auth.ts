/** Human-owned sign-in through the existing official CLI. mitori never handles its auth output or credentials. */
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { PROVIDER_AUTH_IDS, type ProviderAuthId } from "@mitori/core";
import { resolveSafePath } from "@mitori/platform";
import { oneOf, parse } from "./args.ts";
import { type Io, usage } from "./io.ts";
import { type AuthSpawn, spawnOfficialLogin } from "./process-io.ts";
import { requireTty } from "./session.ts";
import { binaryOf } from "./setup.ts";

export type { AuthSpawn } from "./process-io.ts";

/** Only the native process boundary is injectable; no auth responses are returned to mitori. */
export interface AuthDeps {
  which(name: string, path: string): string | null;
  spawn(spec: AuthSpawn): Promise<number>;
}

const LOGIN: Readonly<Partial<Record<ProviderAuthId, { binary: string; args: readonly string[] }>>> = {
  claude: { binary: "claude", args: ["auth", "login"] },
  muse: { binary: "muse", args: ["login"] },
  codex: { binary: "codex", args: ["login"] },
  cursor: { binary: "cursor-agent", args: ["login"] },
  grok: { binary: "agent", args: ["login", "--oauth"] },
  ollama: { binary: "ollama", args: ["signin"] },
};

/** Native auth directories are reused only by the matching provider's auth-only command. */
const AUTH_DIRS: Readonly<Partial<Record<ProviderAuthId, readonly string[]>>> = {
  claude: ["CLAUDE_CONFIG_DIR"],
  codex: ["CODEX_HOME"],
  muse: ["XDG_CONFIG_HOME"],
  cursor: ["XDG_CONFIG_HOME"],
};

const ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "USERPROFILE",
  "SYSTEMROOT",
  "WINDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_MESSAGES",
  "TERM",
  "COLORTERM",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;

const hasControlCharacters = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

function reviewedBinary(path: string): { realpath: string; sha256: string } {
  try {
    const realpath = realpathSync(path);
    if (hasControlCharacters(realpath)) throw new Error("control characters in executable path");
    if (!statSync(realpath).isFile()) throw new Error("not a regular file");
    accessSync(realpath, constants.X_OK);
    return { realpath, sha256: createHash("sha256").update(readFileSync(realpath)).digest("hex") };
  } catch {
    throw usage("the selected official executable is missing, unreadable, or not executable");
  }
}

export async function runWith(io: Io, deps: AuthDeps): Promise<number> {
  const { values, positionals } = parse(io.argv, { binary: { type: "string" } }, "auth");
  const provider = oneOf(positionals[0], PROVIDER_AUTH_IDS, "provider", "auth");
  if (!provider || positionals.length !== 1) throw usage(`choose ${PROVIDER_AUTH_IDS.join(" | ")}`, "mitori auth --help");
  requireTty(io, "mitori auth");
  if (provider === "antigravity") {
    if (values.binary) throw usage("Antigravity has no verified login-only CLI command; sign in from its official app");
    io.out(
      "Antigravity の公式アプリでサインインしてください。ログイン専用の CLI コマンドは確認できないため、エージェントは起動しません。\nhttps://antigravity.google/docs/cli/install/\n",
    );
    return 0;
  }
  if (values.binary && (!isAbsolute(values.binary) || hasControlCharacters(values.binary)))
    throw usage("--binary must be an absolute path without control characters");
  const login = LOGIN[provider];
  if (!login) throw usage("this provider has no verified login-only command");
  const steps: readonly (readonly string[])[] = provider === "muse" ? [["logout"], login.args] : [login.args];
  const path = resolveSafePath(io.env.PATH ?? "", { workspaceRoots: [], startCwd: io.cwd });
  // The ambiguous name `agent` is never resolved on PATH: it can identify an unrelated provider.
  const found = values.binary ?? (provider === "grok" ? (io.env.HOME ? join(io.env.HOME, ".grok/bin/agent") : undefined) : deps.which(login.binary, path));
  if (!found) throw usage(`${login.binary} was not found; install it using official instructions or pass --binary /absolute/path`);
  if (!isAbsolute(found) || hasControlCharacters(found)) throw usage("the executable path must be absolute and contain no control characters");
  const binary = provider === "claude" || provider === "muse" ? binaryOf(provider, found) : found;
  if (!binary) throw usage("the selected provider executable was not found");
  const reviewed = reviewedBinary(binary);
  if (provider === "grok" && !/^grok-\d[\w.-]*(?:\.exe)?$/.test(basename(reviewed.realpath)))
    throw usage("Grok login requires its known native grok-version binary; a generic agent executable is not accepted");
  if (provider === "cursor" && !/^cursor-agent(?:\.exe)?$/.test(basename(reviewed.realpath)))
    throw usage("Cursor login requires the official cursor-agent executable; a generic agent executable is not accepted");
  const authDirs: Record<string, string> = {};
  for (const key of AUTH_DIRS[provider] ?? []) {
    const value = io.env[key];
    if (value === undefined) continue;
    if (!isAbsolute(value) || hasControlCharacters(value)) throw usage(`${key} must be an absolute path without control characters`);
    authDirs[key] = value;
  }
  io.out(
    `Official ${provider} sign-in\nExecutable: ${reviewed.realpath}\nSHA-256 (executable/launcher): ${reviewed.sha256}\nArguments: ${steps.map((args) => args.join(" ")).join(" → ")}\n`,
  );
  for (const [key, value] of Object.entries(authDirs)) io.out(`${key}: ${value}\n`);
  if (provider === "muse") io.out("Muse は既存のサインインと保存済み API キーを logout で解除してから、ブラウザのアカウント認証で login します。\n");
  io.out("認証は公式ツールとブラウザで完了します。mitori は認証情報を取得せず、モデルも呼び出しません。\n");
  if (!(await io.confirm("この公式ツールでサインインを開始しますか？ / Start official sign-in?"))) return 1;
  const env: Record<string, string> = { PATH: path, ...authDirs };
  for (const key of ENV_KEYS) if (typeof io.env[key] === "string") env[key] = io.env[key];
  if (provider === "ollama") env.OLLAMA_HOST = "http://127.0.0.1:11434";
  for (const args of steps) {
    const current = reviewedBinary(binary);
    if (current.realpath !== reviewed.realpath || current.sha256 !== reviewed.sha256)
      throw usage("the executable changed after confirmation; retry and review it again");
    const code = await deps.spawn({ cmd: [reviewed.realpath, ...args], env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    if (code !== 0) return code;
  }
  io.out("公式の認証コマンドが終了しました。公式ツール側で完了を確認し、mitori の設定を再読み込みしてください。\n");
  if (provider === "ollama") io.out("ローカルモデルはログイン不要です。クラウドモデルは Ollama の利用枠・クレジットを消費します。\n");
  return 0;
}

export const run = (io: Io): Promise<number> =>
  runWith(io, {
    which: (name, path) => Bun.which(name, { PATH: path }),
    spawn: spawnOfficialLogin,
  });
