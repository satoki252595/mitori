// DocStore test harness: real codec + in-memory DB, seeded ids, fake clock/timers, a fake ClaimStamper, and either
// an in-memory SafeWriter or the node:fs spy writer over a temp directory.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  base32,
  type Cite,
  type ClaimChecks,
  type Coverage,
  createSecretScanner,
  type ExcludeReason,
  type Fact,
  type ModuleId,
  type ModuleInfo,
  type SafeWriter,
  type SourceLang,
  type SseEventPayload,
  type WorkspaceInfo,
  type WorkspaceKind,
} from "@mitori/core";
import type { ClaimSpan, ClaimStamper, DocStore, RawCite, StaticDocInput } from "../contract.ts";
import { createAiMarkdownValidator, createDocStore, DOC_MIGRATIONS } from "../store/index.ts";
import { slugify } from "../store/paths.ts";
import { REPO_ROOT } from "./fixture.ts";
import { collect, countingMetrics, fakeClock, hasher, memDb, memSafeWriter, nodeFs, seededIds, serialQueue, silentLog } from "./helpers.ts";

/** Stamper double: blob/snippet from the range, L0 ok unless start > 9000, L1 by identifiers. */
export function fakeStamper(): ClaimStamper & { calls: number } {
  const s = {
    calls: 0,
    async stamp(raw: readonly RawCite[], span: ClaimSpan): Promise<{ cites: Cite[]; checks: ClaimChecks }> {
      s.calls++;
      const cites = raw.map((r) => ({
        ...r,
        blob: hasher.xxh3(r.path).padEnd(40, "0"),
        snippet: hasher.xxh3(`${r.path}:${r.start}-${r.end}`),
        precision: "exact" as const,
      }));
      return {
        cites,
        checks: {
          l0: raw.every((r) => r.start <= 9000),
          l1: span.identifiers.length > 0 ? "pass" : "vacuous",
          l2: true,
          checkedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    },
  };
  return s;
}

export interface Harness {
  store: DocStore & { settled(): Promise<void> };
  clock: ReturnType<typeof fakeClock>;
  events: ReturnType<typeof collect<SseEventPayload>>;
  writer: SafeWriter;
  mem: ReturnType<typeof memSafeWriter> | null;
  db: ReturnType<typeof memDb>;
  ws: WorkspaceInfo;
  stamper: ReturnType<typeof fakeStamper>;
}

export function harness(
  opts: {
    root?: string;
    docDir?: string;
    kind?: WorkspaceKind;
    fs?: boolean;
    writer?: SafeWriter;
    seed?: number;
    committed?: boolean;
    db?: ReturnType<typeof memDb>;
  } = {},
): Harness {
  const clock = fakeClock();
  const db = opts.db ?? memDb(DOC_MIGRATIONS);
  const events = collect<SseEventPayload>();
  const mem = opts.writer ? null : memSafeWriter();
  const writer = opts.writer ?? (mem as SafeWriter);
  const ws: WorkspaceInfo = {
    key: "ws_000000000000",
    root: opts.root ?? "/repo",
    kind: opts.kind ?? "git",
    name: "fixture",
    docDir: opts.docDir ?? ".mitori",
    docCommitted: opts.committed ?? false,
  };
  const stamper = fakeStamper();
  const deps = {
    ws,
    db,
    write: serialQueue(),
    safeWrite: writer,
    hasher,
    ids: seededIds(opts.seed ?? 1),
    stamper,
    secrets: createSecretScanner(),
    aiMarkdown: createAiMarkdownValidator(),
    log: silentLog,
    clock,
    metrics: countingMetrics(),
    events,
    ...(opts.fs ? { fs: nodeFs } : {}),
    timers: clock,
  };
  const store = createDocStore(deps) as DocStore & { settled(): Promise<void> };
  return { store, clock, events, writer, mem, db, ws, stamper };
}

interface TruthFile {
  path: string;
  class: string;
  lang: string;
  excluded?: ExcludeReason;
}
interface TruthFactRow {
  kind: Fact["kind"];
  path: string;
  line?: number;
  key: string;
  attrs?: Record<string, unknown>;
}

const SRC_LANGS = new Set<SourceLang>(["typescript", "tsx", "javascript", "jsx", "python", "go", "rust", "java", "csharp", "php"]);

function mdId(seed: string): ModuleId {
  const hex = hasher.xxh3(seed);
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return `md_${base32(bytes).slice(0, 8)}`;
}

function factOf(t: TruthFactRow): Fact {
  const base = { detector: `${t.kind}.truth@1`, path: t.path, line: t.line ?? 1, blob: "0".repeat(40) };
  const a = t.attrs ?? {};
  switch (t.kind) {
    case "route": {
      const [method, ...rest] = t.key.split(" ");
      return { ...base, kind: "route", method: method ?? "ANY", pattern: rest.join(" "), framework: String(a.framework ?? "unknown") };
    }
    case "cli":
      return { ...base, kind: "cli", command: t.key, flags: (a.flags as string[] | undefined) ?? [], framework: String(a.framework ?? "unknown") };
    case "env":
      return { ...base, kind: "env", name: t.key, hasDefault: a.hasDefault === true };
    case "entry":
      return { ...base, kind: "entry", entry: (t.key.split(":")[0] as "main") ?? "main", label: t.key.split(":").slice(1).join(":") || t.path };
    case "schema":
      return {
        ...base,
        kind: "schema",
        entity: t.key.split(":").slice(1).join(":") || t.key,
        source: t.key.split(":")[0] ?? "sql",
        fields: (a.fields as string[] | undefined) ?? [],
      };
    case "test":
      return { ...base, kind: "test", name: t.key };
    case "script":
      return { ...base, kind: "script", name: t.key, command: String(a.command ?? t.key), purpose: (a.purpose as "build") ?? "other" };
    case "dependency":
      return {
        ...base,
        kind: "dependency",
        ecosystem: (t.key.split(":")[0] as "npm") ?? "other",
        name: t.key.split(":").slice(1).join(":"),
        version: String(a.version ?? "*"),
        dev: a.dev === true,
      };
    case "existing_doc":
      return { ...base, kind: "existing_doc", role: (t.key as "readme") ?? "other", title: String(a.title ?? t.path) };
    case "todo":
      return { ...base, kind: "todo", marker: (t.key as "TODO") ?? "TODO", text: String(a.text ?? "") };
    default:
      return { ...base, kind: "config", tool: t.key, role: "other" };
  }
}

/** StaticDocInput from a fixture's hand-written truth (the indexer is another WP): one module per source directory. */
export function staticInputFromTruth(name: string): StaticDocInput {
  const truth = JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/truth", `${name}.json`), "utf8")) as { files: TruthFile[]; facts: TruthFactRow[] };
  let commits: string[] = [];
  try {
    commits = (JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/golden", name, "commits.json"), "utf8")) as { commits: string[] }).commits;
  } catch {
    commits = [];
  }
  const files = truth.files;
  const excluded: Partial<Record<ExcludeReason, number>> = {};
  for (const f of files) if (f.excluded) excluded[f.excluded] = (excluded[f.excluded] ?? 0) + 1;
  const included = files.filter((f) => !f.excluded);
  const sources = included.filter((f) => f.class === "source" && SRC_LANGS.has(f.lang as SourceLang));
  const byDir = new Map<string, string[]>();
  for (const f of sources) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ".";
    byDir.set(dir, [...(byDir.get(dir) ?? []), f.path]);
  }
  const modules: ModuleInfo[] = [...byDir.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dir, paths]) => ({
      id: mdId(`${name}:${dir}`),
      slug: dir === "." ? "root" : slugify(dir),
      name: dir === "." ? name : (dir.split("/").pop() as string),
      children: [],
      paths: paths.sort(),
      loc: paths.length * 40,
      rank: Math.round((paths.length / Math.max(1, sources.length)) * 1e4) / 1e4,
      membersDigest: hasher.xxh3(paths.join("\n")),
      ifaceDigest: hasher.xxh3(`iface:${dir}`),
      crossCutting: false,
      topoOrder: 0,
    }));
  const langs = new Map<SourceLang, number>();
  for (const f of sources) langs.set(f.lang as SourceLang, (langs.get(f.lang as SourceLang) ?? 0) + 40);
  const coverage: Coverage = {
    filesTotal: files.length,
    filesIncluded: included.length,
    filesExcluded: excluded,
    locIncluded: sources.length * 40,
    modulesTotal: modules.length,
    modulesGenerated: 0,
    claimsTotal: 0,
    claimsVerified: 0,
  };
  return {
    snapshot: {
      commit: commits[commits.length - 1] ?? null,
      tree: null,
      branch: commits.length > 0 ? "main" : null,
      dirty: false,
      indexDigest: hasher.xxh3(files.map((f) => f.path).join("\n")),
      takenAt: "2026-01-01T00:00:00.000Z",
    },
    coverage,
    facts: truth.facts.map(factOf),
    modules,
    diagrams: [],
    license: files.some((f) => /^LICENSE/i.test(f.path)) ? "MIT" : null,
    languages: [...langs.entries()].map(([lang, loc]) => ({ lang, loc })),
    lazyModules: [],
  };
}
