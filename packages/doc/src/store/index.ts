/**
 * @mitori/doc — `store/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type {
  Clock,
  EventSink,
  Hasher,
  Logger,
  Metrics,
  Migration,
  SafeWriter,
  SecretScanner,
  SqlDb,
  SseEventPayload,
  WorkspaceInfo,
  WriteQueue,
} from "@mitori/core";
import type { AiMarkdownValidator, ClaimStamper, DocStore, GenIdSource } from "../contract.ts";
import type { StoreDeps } from "./core.ts";
import { MIGRATIONS } from "./migrations.ts";
import { makeDocStore } from "./store.ts";
import { aiMarkdownValidator } from "./validator.ts";

/** Factory (pure). */
export function createAiMarkdownValidator(): AiMarkdownValidator {
  return aiMarkdownValidator();
}

/**
 * Factory. CR-PENDING(WP-04): the deps object may also carry `fs` (FsReader: load() + the ownership ledger) and
 * `timers` (flush cadence; FakeClock in tests) until the contract lists them (docs/design/cr-requests/WP-04.md).
 */
export function createDocStore(deps: {
  /** Workspace. */
  ws: WorkspaceInfo;
  /** Workspace DB (`doc_*`: history with text, proposals, translations, tombstones, decisions, html, layouts, files ledger, cites). */
  db: SqlDb;
  /** Single-writer queue of the workspace (mutators assert they run inside it) [CONS-03]. */
  write: WriteQueue;
  /** The only file writer (kind `doc`; root = realpath(docDir)) [SEC-01]. */
  safeWrite: SafeWriter;
  /** Hasher. */
  hasher: Hasher;
  /** Id source over core `newId(kind, random)` (seeded in tests). */
  ids: GenIdSource;
  /** Claim stamper (gen Verifier, injected by the server) [CONS-06]. */
  stamper: ClaimStamper;
  /** Secret scanner (rendered HTML, export) [CONS-05]. */
  secrets: SecretScanner;
  /** AI-md validator for proposals [SEC-11]. */
  aiMarkdown: AiMarkdownValidator;
  /** Logger. */
  log: Logger;
  /** Clock. */
  clock: Clock;
  /** Metrics (`doc.*`). */
  metrics: Metrics;
  /** Events (`doc.*`). */
  events: EventSink<SseEventPayload>;
}): DocStore {
  return makeDocStore(deps as StoreDeps);
}

/** SQLite migrations owned by `@mitori/doc` (`doc_*`). */
export const DOC_MIGRATIONS: readonly Migration[] = MIGRATIONS;
