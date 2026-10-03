/**
 * @mitori/doc — `store/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import {
  type Clock,
  type EventSink,
  type Hasher,
  type Logger,
  type Metrics,
  type Migration,
  type SafeWriter,
  type SecretScanner,
  type SqlDb,
  type SseEventPayload,
  unsupported,
  type WorkspaceInfo,
  type WriteQueue,
} from "@mitori/core";
import type { AiMarkdownValidator, ClaimStamper, DocStore, GenIdSource } from "../contract.ts";
import { MIGRATIONS } from "./migrations.ts";

/** Factory (pure). */
export function createAiMarkdownValidator(): AiMarkdownValidator {
  return unsupported("doc.createAiMarkdownValidator");
}

/** Factory. */
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
  return unsupported("doc.createDocStore", deps);
}

/** SQLite migrations owned by `@mitori/doc` (`doc_*`). */
export const DOC_MIGRATIONS: readonly Migration[] = MIGRATIONS;
