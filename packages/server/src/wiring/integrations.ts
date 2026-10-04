/**
 * `GET /integrations` and `POST /integrations/:target/install` (loop spec §11, CONS-22): adapters over the GLOBAL
 * installer (`@mitori/loop` `createInstaller`). `mitori install claude-code|codex|agents-md` calls them; the files are
 * written through SafeWriter, user-edited files stay untouched unless `force` (the CLI confirms that on a TTY), and the
 * view lists every file the target × scope consists of with its freshness (`current` / `outdated` / `modified` /
 * `missing`, sha256 against what mitori last wrote).
 */
import { type InstallReq, type IntegrationStatusView, MitoriError, type WorkspaceInfo, type WorkspaceKey } from "@mitori/core";
import type { Installer, IntegrationState } from "@mitori/loop";
import type { RouteHandlers } from "../routes/types.ts";

type Target = IntegrationStatusView["target"];
type Scope = IntegrationStatusView["scope"];

/** The installer's per-file check (`makeInstaller().states`, CR-PENDING(ux) cr-requests/ux.md #5). */
interface FileState {
  abs: string;
  rel: string;
  state: IntegrationState;
  recorded: boolean;
}
type InstallerExt = Installer & {
  states(target: Target, scope: Scope, opts: { mcp: boolean; project?: { root: string; docDir: string } }): Promise<FileState[]>;
};

export interface IntegrationEnv {
  installer: Installer;
  /** A registered workspace (project-scope installs write into its repository). */
  workspace(ws: WorkspaceKey): Promise<WorkspaceInfo | null>;
}

const TARGETS: readonly Target[] = ["claude-code", "codex", "agents-md"];
/** What each scope offers (agents-md is the repository's AGENTS.md: project only). */
const BY_SCOPE: Record<Scope, readonly Target[]> = { user: ["claude-code", "codex"], project: ["claude-code", "codex", "agents-md"] };

const invalid = (field: string, message: string) => new MitoriError("E_INVALID_INPUT", message, { params: { field } });

function statesOf(installer: Installer): InstallerExt["states"] {
  const x = installer as Partial<InstallerExt>;
  if (typeof x.states !== "function") throw new MitoriError("E_UNSUPPORTED", "this installer cannot report file states");
  return x.states.bind(installer);
}

/** The view of one target × scope. MCP is opt-in: its `.mcp.json` is listed (and `mcp: true`) only once mitori wrote it. */
export async function integrationView(env: IntegrationEnv, target: Target, scope: Scope, info: WorkspaceInfo | null): Promise<IntegrationStatusView> {
  const project = scope === "project" && info ? { root: info.root, docDir: info.docDir } : undefined;
  const files = await statesOf(env.installer)(target, scope, { mcp: true, ...(project ? { project } : {}) });
  const isMcp = (f: FileState) => f.rel.endsWith(".mcp.json");
  const mcp = files.some((f) => isMcp(f) && f.recorded && f.state !== "missing");
  return {
    target,
    scope,
    files: files.filter((f) => !isMcp(f) || f.recorded).map((f) => ({ path: f.abs, state: f.state })),
    mcp,
  };
}

export function integrationHandlers(env: IntegrationEnv): RouteHandlers {
  const workspaceOf = async (ws: unknown): Promise<WorkspaceInfo> => {
    if (typeof ws !== "string" || ws === "") throw invalid("ws", "a project install names its workspace (ws)");
    const info = await env.workspace(ws as WorkspaceKey);
    if (!info) throw new MitoriError("E_WS_NOT_FOUND", "workspace is not registered", { params: { ws } });
    return info;
  };

  return {
    "GET /integrations": async (ctx) => {
      const ws = ctx.query.get("ws");
      const info = ws ? await workspaceOf(ws) : null;
      const out: IntegrationStatusView[] = [];
      for (const scope of ["user", "project"] as const) {
        if (scope === "project" && !info) continue;
        for (const target of BY_SCOPE[scope]) out.push(await integrationView(env, target, scope, info));
      }
      return out;
    },
    "POST /integrations/:target/install": async (ctx) => {
      const target = ctx.params.target;
      if (!TARGETS.includes(target)) throw invalid("target", "target must be claude-code|codex|agents-md");
      const req = (ctx.body ?? {}) as Partial<InstallReq>;
      if (req.scope !== "user" && req.scope !== "project") throw invalid("scope", "scope must be user|project");
      if (!BY_SCOPE[req.scope].includes(target)) throw invalid("scope", `${target} is a ${req.scope === "user" ? "project" : "user"} integration`);
      if (req.mcp !== undefined && typeof req.mcp !== "boolean") throw invalid("mcp", "mcp must be a boolean");
      if (req.force !== undefined && typeof req.force !== "boolean") throw invalid("force", "force must be a boolean");
      const info = req.scope === "project" ? await workspaceOf(req.ws) : null;
      if (info && info.kind !== "git")
        throw new MitoriError("E_PRECONDITION", "a project integration is written into a git repository", { params: { kind: info.kind } });
      const project = info ? { root: info.root, docDir: info.docDir } : undefined;
      // CR-PENDING(WP-11) cr-requests/WP-11.md #2: the contract's options have no project; the installer reads it here
      const opts = { mcp: req.mcp === true, force: req.force === true, ...(project ? { project } : {}) };
      await env.installer.install(target, req.scope, opts);
      return integrationView(env, target, req.scope, info);
    },
  };
}
