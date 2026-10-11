/**
 * `mitori install <claude-code|claude|codex|agents-md> [--scope user|project] [--mcp] [--force] [--yes]` (loop spec §11,
 * CONS-22): the daemon's global installer writes the files (`POST /integrations/:target/install`) — files the user
 * edited stay untouched unless `--force`, which shows them and asks on a TTY first (refused for agents, exit 2).
 * Then the commands that register the plugin are printed, or run with `--yes`.
 */
import type { IntegrationStatusView } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { createSafeWriter, createSpawner } from "@mitori/platform";
import { materializeWindowsJob } from "../build/windows-job.ts";
import { oneOf, parse } from "./args.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { connect, requireTty } from "./session.ts";
import { openWorkspace } from "./workspace.ts";

type Target = IntegrationStatusView["target"];
const TARGETS = ["claude-code", "claude", "codex", "agents-md"] as const;

/** What to run after the files are in place (spec §11.1–§11.2; mirrors the installer's `nextCommands`). */
export function nextCommands(target: Target, scope: "user" | "project", mcp: boolean, update: boolean, bin = "mitori"): string[] {
  if (target === "claude-code" && scope === "user")
    return update
      ? ["claude plugin marketplace update mitori-local", "claude plugin update mitori@mitori-local"]
      : ["claude plugin marketplace add ~/.mitori/integrations/claude-code", "claude plugin install mitori@mitori-local"];
  if (target === "claude-code") return [...(mcp ? [`claude mcp add mitori -- ${bin} mcp`] : []), "mitori install agents-md"];
  if (target === "codex" && mcp) return [`codex mcp add mitori -- ${bin} mcp`];
  return [];
}

/** A daemon without the installer routes (501) gets a pointer to the same files in the repository. */
async function noInstaller<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = MitoriError.from(e);
    if (m.code !== "E_UNSUPPORTED") throw m;
    throw new MitoriError(m.code, m.message, { hint: "this daemon has no installer yet; the same files are in the repository's integrations/ directory" });
  }
}

const MARK: Record<string, string> = { current: "✓", outdated: "↻", modified: "✎", missing: "·" };

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    { scope: { type: "string" }, mcp: { type: "boolean" }, force: { type: "boolean" }, yes: { type: "boolean" } },
    "install",
  );
  const raw = oneOf(positionals[0], TARGETS, "target", "install");
  if (raw === undefined || positionals.length > 1) throw usage("name one target: claude-code | codex | agents-md", "mitori install --help");
  const target: Target = raw === "claude" ? "claude-code" : raw;
  const scope = oneOf(values.scope, ["user", "project"] as const, "scope", "install") ?? (target === "agents-md" ? "project" : "user");
  if (target === "agents-md" && scope !== "project") throw usage("agents-md writes the repository's AGENTS.md (project scope)");
  const mcp = values.mcp === true;
  const force = values.force === true;
  const lang = helpLang(io.env);
  if (force) requireTty(io, "mitori install --force");

  const s = await connect(io);
  const ws = scope === "project" ? (await openWorkspace(io, s.api)).info.key : undefined;
  const before = (await noInstaller(() => s.api.call("GET /integrations", { params: {}, query: ws ? { ws } : {} }))).find(
    (v) => v.target === target && v.scope === scope,
  );
  if (force) {
    const touched = before?.files.filter((f) => f.state === "modified") ?? [];
    if (touched.length > 0) {
      io.err(
        `${lang === "ja" ? "あなたが編集したファイルを上書きします" : "These files you edited will be overwritten"}:\n${touched.map((f) => `  ${f.path}\n`).join("")}`,
      );
      if (!(await io.confirm(lang === "ja" ? "上書きしますか？" : "Overwrite them?"))) return 1;
    }
  }
  const view = await noInstaller(() =>
    s.api.call("POST /integrations/:target/install", { params: { target }, body: { scope, ...(ws ? { ws } : {}), mcp, force } }),
  );
  for (const f of view.files) io.out(`${MARK[f.state] ?? "?"} ${f.state.padEnd(8)} ${f.path}\n`);
  const kept = view.files.filter((f) => f.state === "modified");
  if (kept.length > 0)
    io.err(
      lang === "ja"
        ? `編集済みの ${kept.length} ファイルはそのままです（--force で上書き）\n`
        : `${kept.length} edited file(s) left as they are (--force overwrites)\n`,
    );
  const update = before?.files.some((f) => f.path.endsWith("marketplace.json") && f.state !== "missing") ?? false;
  const next = nextCommands(target, scope, mcp, update, io.bin);
  if (next.length === 0) return 0;
  if (values.yes !== true) {
    io.out(`${lang === "ja" ? "次に実行" : "next"}:\n${next.map((c) => `  ${c}\n`).join("")}`);
    return 0;
  }
  const commands = next.filter((c) => c.startsWith("claude plugin "));
  if (commands.length === 0) return 0;
  const windowsJobLauncher = process.platform === "win32" ? await materializeWindowsJob(s.home, createSafeWriter()) : undefined;
  const spawner = createSpawner(windowsJobLauncher ? { windowsJobLauncher } : {});
  for (const cmd of commands) {
    const [command, ...argv] = cmd.replace("~/", `${io.env.HOME ?? ""}/`).split(" ") as [string, ...string[]];
    const child = spawner.spawn({
      command,
      argv,
      env: { PATH: io.env.PATH ?? "", HOME: io.env.HOME ?? "" },
      cwd: io.cwd,
      stdin: "",
      keepStdinOpen: false,
      timeoutMs: 0,
      processGroup: false,
    });
    const code = await child.exited;
    io.err(`${cmd} → exit ${code}\n`);
    if (code !== 0) return 1;
  }
  return 0;
}
