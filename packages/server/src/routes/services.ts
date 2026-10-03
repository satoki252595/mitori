/**
 * What the router needs from the rest of the daemon. The composition root (WP-INT) fills `domain` with the
 * providers that need domain packages; every one of them is optional and has a neutral fallback.
 */
import type {
  BlockId,
  Clock,
  EngineStatus,
  GitStatusView,
  Hasher,
  InitReq,
  Iso8601,
  Logger,
  Metrics,
  Random,
  SchedulerStatus,
  SectionId,
  WorkspaceStatus,
} from "@mitori/core";
import type { BearerAuth } from "../auth/bearer.ts";
import type { NonceStore } from "../auth/nonce.ts";
import type { SessionServiceImpl } from "../auth/session.ts";
import type { InboxSources, StateRuntime, WorkspaceRuntime } from "../contract.ts";
import type { Timers } from "../http/timers.ts";
import type { SettingsService } from "../settings/service.ts";
import type { SseHubImpl } from "../sse/hub.ts";
import type { TrustServiceImpl } from "../trust/service.ts";
import type { WorkspaceManagerImpl } from "../ws/manager.ts";
import type { WaiterRegistry } from "./waiters.ts";

/** Static facts about this daemon process. */
export interface DaemonInfo {
  version: string;
  pid: number;
  startedAt: Iso8601;
  build: "release" | "test";
  /** Bound port (Host gate, nonce URLs). */
  port(): number;
}

/** Lifecycle hooks and global status the daemon owns. */
export interface DaemonControl {
  /** Begin the graceful stop (the HTTP response goes out first). */
  shutdown(reason: string, force: boolean): void;
  shuttingDown(): boolean;
  scheduler(): SchedulerStatus;
  engines(): EngineStatus[];
  rssMb(): number;
}

/** Domain-derived parts of `GET /ws/:ws`. */
export type WorkspaceStatusDomain = Pick<WorkspaceStatus, "counts" | "doc" | "snapshot" | "scan" | "gen" | "genEngine">;

/** Providers that need domain packages (composition root). */
export interface DomainProviders {
  status?(rt: WorkspaceRuntime): Partial<WorkspaceStatusDomain> | Promise<Partial<WorkspaceStatusDomain>>;
  git?(rt: WorkspaceRuntime): Promise<GitStatusView>;
  init?(rt: WorkspaceRuntime, req: InitReq): Promise<void>;
  /** Inbox rows other than trust (loop threads/jobs, doc proposals, gen runs, suggestions). */
  inbox?(rt: WorkspaceRuntime): Omit<InboxSources, "trust"> | Promise<Omit<InboxSources, "trust">>;
  /** Section of a block (portable permalinks). */
  sectionOf?(rt: WorkspaceRuntime, block: BlockId): SectionId | null;
}

export interface ServerServices {
  info: DaemonInfo;
  control: DaemonControl;
  clock: Clock;
  random: Random;
  hasher: Hasher;
  log: Logger;
  metrics: Metrics;
  timers: Timers;
  state: StateRuntime;
  hub: SseHubImpl;
  bearer: BearerAuth;
  sessions: SessionServiceImpl;
  nonces: NonceStore;
  settings: SettingsService;
  trust: TrustServiceImpl;
  workspaces: WorkspaceManagerImpl;
  waiters: WaiterRegistry;
  domain: DomainProviders;
}
