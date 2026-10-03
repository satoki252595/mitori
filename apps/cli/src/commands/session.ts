/**
 * The common prologue of the client commands: `~/.mitori`, the daemon (started headless when needed), a typed API
 * client with the Pull headers, the workspace of the cwd — and the TTY rule of loop spec §10 R1 (SEC-04): commands
 * that spend money, publish or execute (`gen` push, `init --commit`, `install --force`, `config set`, `pr`) refuse
 * under CLAUDECODE / CODEX_* or without a terminal with `E_TTY_REQUIRED`, exit 2.
 */
import type { ApiClient } from "@mitori/client";
import { type ClientKind, MitoriError, type WorkspaceSummary } from "@mitori/core";
import { resolveHome } from "@mitori/platform";
import { apiOf, type Daemon, ensureDaemon, findDaemon } from "./daemon-client.ts";
import { CliExit, type Io } from "./io.ts";
import { isCodexEnv } from "./loop-contract.ts";
import { openWorkspace } from "./workspace.ts";

export interface Session {
  home: string;
  daemon: Daemon;
  api: ApiClient;
}

/** `~/.mitori` (or `MITORI_HOME`), created 0700. */
export function homeOf(io: Io): string {
  return resolveHome({ env: io.env });
}

/** The daemon (started when `start`, the default) and an API client. */
export async function connect(io: Io, opts: { kind?: ClientKind; agent?: string; waiter?: string; start?: boolean } = {}): Promise<Session> {
  const home = homeOf(io);
  const daemon = opts.start === false ? await findDaemon(io, home) : await ensureDaemon(io, home);
  if (!daemon) throw new MitoriError("E_NOT_READY", "no mitori daemon is running", { hint: "run `mitori` in the repository first" });
  const api = apiOf(io, daemon, {
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.agent ? { agent: opts.agent } : {}),
    ...(opts.waiter ? { waiter: opts.waiter } : {}),
  });
  return { home, daemon, api };
}

/** {@link connect} + the workspace of the cwd. */
export async function connectWorkspace(
  io: Io,
  opts: { kind?: ClientKind; agent?: string; waiter?: string; force?: boolean } = {},
): Promise<Session & { ws: WorkspaceSummary }> {
  const s = await connect(io, opts);
  const ws = await openWorkspace(io, s.api, opts.force ? { force: true } : {});
  return { ...s, ws };
}

/** An agent session (Claude Code / Codex) — never a human at a terminal. */
export function isAgentEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.CLAUDECODE === "1" || isCodexEnv(env);
}

/** Refuse unless a human at a terminal runs this (exit 2). */
export function requireTty(io: Io, what: string, webHint?: string): void {
  if (io.isTTY && !isAgentEnv(io.env)) return;
  const why = isAgentEnv(io.env) ? "agents cannot confirm it" : "stdin/stdout is not a terminal";
  throw new CliExit(2, new MitoriError("E_TTY_REQUIRED", `${what} needs a human confirmation at a terminal (${why})`), webHint);
}

/** `http://127.0.0.1:<port>` + path. */
export const urlOf = (s: Session, path: string) => `${s.daemon.origin}${path}`;
