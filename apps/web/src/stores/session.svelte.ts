/**
 * Session-wide state (contract `SessionStore`): daemon, engines, scheduler, usage ticker, connection, the
 * workspace list (Launcher) and the global settings view (prefs reconcile with the cookie).
 */
import type { ApiClient, ConnectionState } from "@mitori/client";
import type { DaemonStatus, EngineStatus, SchedulerStatus, SettingsView, SubscriptionWindow, UsageTotals, WorkspaceSummary } from "@mitori/core";
import type { SessionStore } from "../contract.ts";

export class SessionState implements SessionStore {
  daemon = $state.raw<DaemonStatus | null>(null);
  today = $state.raw<UsageTotals | null>(null);
  window = $state.raw<SubscriptionWindow | null>(null);
  connection = $state.raw<ConnectionState>({ kind: "connecting" });
  workspaces = $state.raw<readonly WorkspaceSummary[]>([]);
  engines = $state.raw<readonly EngineStatus[] | null>(null);
  scheduler = $state.raw<SchedulerStatus | null>(null);
  settings = $state.raw<SettingsView | null>(null);
  workspacesLoaded = $state(false);

  private readonly api: ApiClient;

  constructor(api: ApiClient) {
    this.api = api;
  }

  async loadDaemon(): Promise<void> {
    try {
      const d = await this.api.call("GET /daemon", { params: {} });
      this.daemon = d;
      this.scheduler = d.scheduler;
      if (!this.engines) this.engines = d.engines;
    } catch {
      /* status bar shows the connection state instead */
    }
  }

  async loadEngines(): Promise<void> {
    try {
      this.engines = await this.api.call("GET /engines", { params: {} });
    } catch {
      /* the engine card falls back to "unknown" */
    }
  }

  async loadUsage(): Promise<void> {
    try {
      const u = await this.api.call("GET /usage/summary", { params: {}, query: { range: "today" } });
      this.today = u.totals;
      this.window = u.window ?? this.window;
    } catch {
      /* optional */
    }
  }

  async loadWorkspaces(): Promise<void> {
    try {
      const list = await this.api.call("GET /workspaces", { params: {} });
      this.workspaces = [...list].sort((a, b) => (b.info.lastOpenedAt ?? "").localeCompare(a.info.lastOpenedAt ?? ""));
    } finally {
      this.workspacesLoaded = true;
    }
  }

  #settingsP: Promise<SettingsView | null> | null = null;

  /** `GET /settings`; `reuse` joins the boot request instead of fetching again. */
  loadSettings(opts: { reuse?: boolean } = {}): Promise<SettingsView | null> {
    if (opts.reuse && this.#settingsP) return this.#settingsP;
    const p = (async () => {
      try {
        this.settings = await this.api.call("GET /settings", { params: {} });
      } catch {
        /* cookie values stay in effect */
      }
      return this.settings;
    })();
    this.#settingsP = p;
    return p;
  }

  upsertWorkspace(s: WorkspaceSummary): void {
    const i = this.workspaces.findIndex((w) => w.info.key === s.info.key);
    this.workspaces = i >= 0 ? this.workspaces.with(i, s) : [s, ...this.workspaces];
  }

  /** The engine generation uses (`WorkspaceStatus.genEngine`, else claude-cli). */
  engine(id: string | null): EngineStatus | null {
    return this.engines?.find((e) => e.engine === (id ?? "claude-cli")) ?? null;
  }
}
