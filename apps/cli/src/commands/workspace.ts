/**
 * Which workspace a command is about (loop spec §10): the git toplevel of the cwd (the nearest ancestor holding a
 * `.git` entry — no `git` spawn), or the deepest registered workspace containing the cwd (shadow workspaces), opened
 * with `POST /workspaces {target}`. `touch` only looks workspaces up — it never opens one [SEC-21].
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ApiClient } from "@mitori/client";
import { MitoriError, type WorkspaceInfo, type WorkspaceKey, type WorkspaceStatus, type WorkspaceSummary } from "@mitori/core";
import type { Io } from "./io.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Realpath of `p` (itself when it does not exist). */
export function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Absolute doc directory of a workspace (`docDir` is repo-relative in a repository, absolute for shadow ones). */
export function docDirOf(info: Pick<WorkspaceInfo, "root" | "docDir">): string {
  return isAbsolute(info.docDir) ? info.docDir : resolve(info.root, info.docDir);
}

/** Nearest ancestor of `dir` (inclusive) with a `.git` directory or file; null outside git. */
export function gitToplevel(dir: string): string | null {
  for (let at = real(dir); ; at = dirname(at)) {
    if (existsSync(`${at}/.git`)) return at;
    if (at === "/" || dirname(at) === at) return null;
  }
}

/** The deepest workspace whose root contains `abs`. */
export function workspaceContaining(list: readonly WorkspaceSummary[], abs: string): WorkspaceSummary | null {
  let best: WorkspaceSummary | null = null;
  for (const w of list) {
    const root = w.info.root;
    if ((abs === root || abs.startsWith(root.endsWith("/") ? root : `${root}/`)) && (!best || root.length > best.info.root.length)) best = w;
  }
  return best;
}

/** Retry `fn` while the daemon answers `E_NOT_READY` (workspace loading), up to `maxMs`. */
export async function whenReady<T>(io: Io, fn: () => Promise<T>, maxMs = 30_000, stepMs = 500): Promise<T> {
  const until = io.clock.now() + maxMs;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const m = MitoriError.from(e);
      if (m.code !== "E_NOT_READY" || io.clock.now() + stepMs > until) throw m;
    }
    await sleep(stepMs);
  }
}

/** The workspace of `cwd` (or `path`), opened in the daemon. */
export async function openWorkspace(io: Io, api: ApiClient, opts: { path?: string; force?: boolean } = {}): Promise<WorkspaceSummary> {
  const at = real(opts.path ?? io.cwd);
  const git = gitToplevel(at);
  const registered = workspaceContaining(await api.call("GET /workspaces", { params: {} }), at);
  // a registered workspace deeper than the git toplevel (a shadow workspace inside a monorepo) wins
  const target = registered && (!git || registered.info.root.length >= git.length) ? registered.info.root : (git ?? at);
  return api.call("POST /workspaces", { params: {}, body: { target, ...(opts.force ? { force: true } : {}) } });
}

/** `GET /ws/:ws`, waiting while the workspace loads. */
export function workspaceStatus(io: Io, api: ApiClient, ws: WorkspaceKey, maxMs?: number): Promise<WorkspaceStatus> {
  return whenReady(io, () => api.call("GET /ws/:ws", { params: { ws } }), maxMs);
}
