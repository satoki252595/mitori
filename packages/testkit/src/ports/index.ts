/**
 * @mitori/testkit — `ports/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Clock, type GitOid, type GitReader, type Iso8601, type Migration, type RepoPath, type SqlDb, unsupported, type WorkerPool } from "@mitori/core";
import type { FakeClock, FakeSpawner, TestLogger } from "../contract.ts";

export function createFakeClock(start?: Iso8601): FakeClock {
  return unsupported("testkit.createFakeClock", start);
}

export function createTestLogger(): TestLogger {
  return unsupported("testkit.createTestLogger");
}

/** bun:sqlite `:memory:` with WAL-equivalent pragmas and the given migrations applied in `(pkg, version)` order. */
export function memDb(migrations?: readonly Migration[]): SqlDb {
  return unsupported("testkit.memDb", migrations);
}

/** GitReader over an in-memory file map (blob ids = real git blob ids, sha1). */
export function memGitReader(files: Readonly<Record<RepoPath, string | Uint8Array>>, opts?: { head?: GitOid | null; branch?: string | null }): GitReader {
  return unsupported("testkit.memGitReader", files, opts);
}

export function createFakeSpawner(opts?: { clock?: Clock }): FakeSpawner {
  return unsupported("testkit.createFakeSpawner", opts);
}

/** WorkerPool running `fn` in-thread (unit tests; no wasm worker start-up cost). */
export function inlineWorkerPool<Req, Res>(fn: (req: Req) => Res | Promise<Res>): WorkerPool<Req, Res> {
  return unsupported("testkit.inlineWorkerPool", fn);
}
