/** Progressive initial UI. The renderer is compiled from the same Svelte sources as the enhanced UI.
 * It uses the authenticated daemon's redacted GET DTOs and fixed dry estimate. No browser-supplied HTML. */
import type {
  ApiRoutes,
  DaemonStatus,
  DocOutline,
  DocProposalView,
  EngineStatus,
  InboxItem,
  JobSummary,
  MapView,
  SectionView,
  SettingsView,
  ThreadSummary,
  WorkspaceStatus,
} from "./api.ts";
import type { Effort, EngineId, GenEstimate, MitoriErrorData, ReaderLevel, UiLang, UiSettings } from "./domain.ts";

export interface InitialUiState {
  url: string;
  width: number;
  level: ReaderLevel;
  lang: UiLang;
  theme: UiSettings["theme"];
  railCollapsed: boolean;
  codeWidth: number | null;
  course: string | null;
  read: Record<string, string>;
  welcomeDismissed: boolean;
  mac?: boolean;
  effort?: Effort;
}

export interface InitialUiSnapshot {
  ui: InitialUiState;
  settings: SettingsView;
  status: WorkspaceStatus;
  outline: DocOutline;
  map: MapView | null;
  sections: SectionView[];
  daemon: DaemonStatus | null;
  usage: ApiRoutes["GET /usage/summary"]["res"] | null;
  engines: EngineStatus[];
  threads: ThreadSummary[];
  jobs: JobSummary[];
  inbox: InboxItem[];
  /** Pending proposals only; canonical initial prose shows them before loading the edit controls. */
  proposals?: DocProposalView[];
  estimates?: Partial<Record<Effort, GenEstimate>>;
  estimateError?: MitoriErrorData;
}

export interface InitialUiView {
  html: string;
  snapshot: InitialUiSnapshot;
}

/** Only same-workspace, allowlisted GET paths are accepted by this request-scoped provider. */
export type InitialUiGet = (path: string) => Promise<unknown>;
/** Fixed same-workspace dry estimate only; this capability cannot start or confirm generation. */
export type InitialUiEstimate = (effort: Effort, engine: EngineId) => Promise<GenEstimate>;
export type InitialUiRenderer = (query: URLSearchParams, get: InitialUiGet, estimate: InitialUiEstimate) => Promise<InitialUiView>;
