/**
 * Minimal local fakes for the review-engine tests (the shared `@mitori/testkit` ports are still M0 stubs):
 * bun:sqlite `:memory:` SqlDb, serial WriteQueue, stepping Clock, counter Random, recording doc store / job runner.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Anchor,
  type AnchorInput,
  type Block,
  type BlockId,
  createSecretScanner,
  type Decision,
  type DocProposal,
  type EffectiveSettings,
  type Job,
  type JobEstimate,
  type JobId,
  type SectionNode,
  type SqlDb,
  type SqlParams,
  type SseEventPayload,
  type ThreadDetail,
} from "@mitori/core";
import type { LoopDomainEvent } from "../../contract.ts";
import { type CapturedAnchor, createReviewEngine, type ReviewEngineDeps, type ReviewEngineHandle } from "../engine.ts";
import { LOOP_MIGRATIONS } from "../index.ts";

/** SqlDb over bun:sqlite. */
export function memDb(): SqlDb {
  const db = new Database(":memory:");
  let depth = 0;
  const bind = (p?: SqlParams) => (p === undefined ? [] : Array.isArray(p) ? p : [p]) as never[];
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, p) => {
      const r = db.query(sql).run(...bind(p));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, p?: SqlParams) => db.query(sql).all(...bind(p)) as T[],
    get: <T>(sql: string, p?: SqlParams) => (db.query(sql).get(...bind(p)) as T | null) ?? null,
    tx: <T>(fn: () => T): T => {
      const sp = `sp${depth++}`;
      db.exec(depth === 1 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
      try {
        const r = fn();
        db.exec(depth === 1 ? "COMMIT" : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        db.exec(depth === 1 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}

/** A small doc: two sections, three blocks. */
export function fakeDoc() {
  const sections: SectionNode[] = [
    { id: "s3", title: "主要フロー", file: "doc/03-key-flows.md", blocks: ["b_flow0001", "b_flow0002"], children: [], state: "generated", readingSec: 10 },
    { id: "s6/meta", title: "meta", file: "doc/modules/meta.md", blocks: ["b_meta0001"], children: [], state: "generated", readingSec: 5 },
  ];
  const blocks = new Map<BlockId, Block>();
  for (const s of sections)
    for (const [ord, id] of s.blocks.entries())
      blocks.set(id, {
        id,
        section: s.id,
        file: s.file,
        ord,
        kind: "prose",
        depth: "L1",
        audience: ["dev"],
        lang: "ja",
        origin: "ai",
        status: "ready",
        freshness: "fresh",
        hash: `h_${id}`,
        claims: [],
        readingSec: 3,
        md: `${id} の本文。\n生成失敗時は正確に 1 回だけ再試行する。`,
      } as Block);
  const proposals: Omit<DocProposal, "id" | "state" | "createdAt">[] = [];
  const decisions: { d: Decision; md: string }[] = [];
  return {
    sections: () => sections,
    block: (id: BlockId) => blocks.get(id) ?? null,
    propose(p: Omit<DocProposal, "id" | "state" | "createdAt">): DocProposal {
      proposals.push(p);
      return { ...p, id: `pp_${String(proposals.length).padStart(8, "0")}` as DocProposal["id"], state: "pending", createdAt: "2026-10-03T00:00:00.000Z" };
    },
    writeDecision(d: Decision, md: string): Decision {
      decisions.push({ d, md });
      return d;
    },
    proposals,
    decisions,
  };
}

/** Job runner fake: estimate = 1,000 tokens per thread + 2,000 fixed; create inserts a `job_jobs` row. */
export function fakeJobs(db: SqlDb, opts: { failKinds?: string[]; requiresConfirm?: boolean } = {}) {
  let n = 0;
  const created: { kind: string; threads: string[]; estimateId: string }[] = [];
  const estimates: { kind: string; threads: string[] }[] = [];
  return {
    created,
    estimates,
    async estimate(req: { kind: string; threads: string[] }): Promise<JobEstimate> {
      estimates.push(req);
      const tokens = 2000 + 1000 * req.threads.length;
      return {
        route: {} as JobEstimate["route"],
        estimate: {
          id: `es_${String(++n).padStart(10, "0")}`,
          inTokens: tokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outTokens: 0,
          apiUsd: tokens / 1e6,
          requiresConfirm: opts.requiresConfirm ?? false,
        } as JobEstimate["estimate"],
        bundle: { tokens, omitted: [] },
      };
    },
    async create(req: { kind: string; threads: string[]; estimateId: string }): Promise<Job> {
      if (opts.failKinds?.includes(req.kind)) throw new Error("engine unavailable");
      created.push(req);
      const id = `j_${String(created.length).padStart(10, "0")}` as JobId;
      db.run(
        "INSERT INTO job_jobs (id, kind, threads, engine, route, state, estimate, write_scope, prompt_ver, created_at) VALUES (?, ?, ?, 'claude-cli', '{}', 'queued', '{}', '[]', 'p@1', ?)",
        [id, req.kind, JSON.stringify(req.threads), `2026-10-03T00:00:${String(created.length).padStart(2, "0")}.000Z`],
      );
      return { id, kind: req.kind, threads: req.threads, state: "queued" } as unknown as Job;
    },
  };
}

/** Anchor stamping fake: code ⇒ blob `b0` + snippet of the range; doc ⇒ block hash + quote from offsets. */
export function fakeCapture(doc: ReturnType<typeof fakeDoc>) {
  return (input: AnchorInput): CapturedAnchor => {
    const a: Anchor = { primary: input.primary };
    if (input.code)
      a.code = {
        path: input.code.path,
        start: input.code.start,
        end: input.code.end,
        blob: input.code.blob ?? "b0",
        snippet: `s_${input.code.start}_${input.code.end}`,
      };
    if (input.doc) {
      const b = doc.block(input.doc.block);
      a.doc = { block: input.doc.block, blockHash: b?.hash ?? "h?" };
      if (input.doc.selEnd > input.doc.selStart && b) {
        a.doc.quote = { prefix: "", exact: b.md.slice(input.doc.selStart, input.doc.selEnd), suffix: "" };
        a.doc.offset = input.doc.selStart;
      }
    }
    if (input.diagram) a.diagram = { diagram: input.diagram.diagram, ...(input.diagram.node ? { node: input.diagram.node } : {}) };
    return { anchor: a, aux: input.code ? { code: { text: "range text", symStart: 1 } } : {} };
  };
}

/** A wired engine with recording sinks. */
export function harness(opts: { jobs?: Parameters<typeof fakeJobs>[1]; confirmAbove?: number; bundleTokens?: number } = {}) {
  const db = memDb();
  for (const m of LOOP_MIGRATIONS) db.exec(m.up);
  let t = Date.parse("2026-10-03T09:00:00.000Z");
  const clock = {
    now: () => t,
    iso: () => {
      t += 1;
      return new Date(t).toISOString();
    },
  };
  let r = 0;
  // Counter in the top bytes ⇒ unique, deterministic ids (first id body: "00000000…").
  const random = {
    bytes: (n: number) => {
      const out = new Uint8Array(n);
      let c = r++;
      for (let i = Math.min(n, 4) - 1; i >= 0; i--) {
        out[i] = c & 0xff;
        c >>>= 8;
      }
      return out;
    },
  };
  let chain: Promise<unknown> = Promise.resolve();
  const write = <T>(_label: string, fn: () => T): Promise<T> => {
    const p = chain.then(() => fn());
    chain = p.catch(() => undefined);
    return p;
  };
  const events: SseEventPayload[] = [];
  const domain: LoopDomainEvent[] = [];
  const doc = fakeDoc();
  const jobs = fakeJobs(db, opts.jobs);
  const deps: ReviewEngineDeps = {
    ws: { key: "ws_000000000001", docDir: ".mitori" },
    db,
    write,
    random,
    clock,
    secrets: createSecretScanner(),
    settings: () => ({ global: { limits: { confirmAboveTokens: opts.confirmAbove ?? 100_000 } } }) as unknown as EffectiveSettings,
    events: { emit: (e) => events.push(e) },
    domain: { emit: (e) => domain.push(e) },
    captureAnchor: fakeCapture(doc),
    doc,
    jobs: () => jobs,
    partition: {
      moduleOf: (p) => p.split("/").slice(0, -1).join("/"),
      writeScopeOf: (th: ThreadDetail) => (th.anchor.code ? [th.anchor.code.path] : th.anchor.doc ? ["internal/meta/fetch.go"] : []),
      anchoredLinesOf: (th: ThreadDetail) => (th.anchor.code ? th.anchor.code.end - th.anchor.code.start + 1 : 0),
    },
  };
  if (opts.bundleTokens !== undefined) {
    const k = opts.bundleTokens;
    deps.bundleTokens = () => k;
  }
  const engine: ReviewEngineHandle = createReviewEngine(deps);
  return { engine, db, events, domain, doc, jobs, deps, write };
}

const ROOT = join(import.meta.dir, "../../../../..");

/** Byte-exact golden under `fixtures/golden/` (`MITORI_UPDATE_GOLDEN=1` rewrites). */
export function golden(rel: string, actual: string): { expected: string; actual: string } {
  const p = join(ROOT, "fixtures/golden", rel);
  if (process.env.MITORI_UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, actual);
  }
  return { expected: existsSync(p) ? readFileSync(p, "utf8") : `(missing golden ${rel}; run with MITORI_UPDATE_GOLDEN=1)`, actual };
}
