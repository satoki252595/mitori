/**
 * S9 baselines (gen spec §11.3): what each generated section was generated AGAINST — the module page's interface
 * digest, the route / cli / entry facts of §3, the schema facts of §7 and the module structure of §0–§2. A rule fires
 * while the current index differs from the baseline, so suggestions accumulate across deltas (a new delta replaces
 * the list by recomputing it) and disappear once the section is regenerated (`Incremental.taskDone`, called in the write
 * slot that finishes the task).
 * CR-PENDING(WP-06b): `DocIndex.modules[m].ifaceDigest` is meant to be the digest the page was generated against,
 * but `applyStatic` overwrites it with the current one (cr-requests/WP-06b.md R1). gen keeps its own baselines in
 * `gen_meta` (`s9`), seeded from the doc index the first time a page is seen (before the server re-applies statics).
 * Fact and structure baselines without a record are seeded with the current value (no suggestion on first sight).
 */
import { canonicalJson, type EstimateId, type Hasher, type ModuleId, type SqlDb, type Xxh3 } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";

/** Persisted S9 state. */
export interface S9State {
  /** Schema version. */
  v: 1;
  /** Interface digest each module page was generated against. */
  iface: Record<ModuleId, Xxh3>;
  /** §3 flows were generated against these route / cli / entry facts. */
  flows?: Xxh3;
  /** §7 was generated against these schema facts. */
  schema?: Xxh3;
  /** §0–§2 were generated against this module structure. */
  structure?: Xxh3;
  /** Estimates of the suggestions currently published (removed when the list is replaced). */
  estimates: EstimateId[];
}

/** Current fingerprints of the index inputs the S9 rules compare. */
export interface Fingerprints {
  /** Route / cli / entry facts (identity without line numbers: moving code does not regenerate §3). */
  flows: Xxh3;
  /** Schema facts. */
  schema: Xxh3;
  /** Module membership plus the interface of the top-level parent modules. */
  structure: Xxh3;
}

const KEY = "s9";

/** Load the state (fresh when absent or unreadable). */
export function loadState(db: SqlDb): S9State {
  const row = db.get<{ v: string }>("SELECT v FROM gen_meta WHERE k = ?", [KEY]);
  if (row) {
    try {
      const s = JSON.parse(row.v) as S9State;
      if (s.v === 1) return { ...s, iface: { ...s.iface }, estimates: [...(s.estimates ?? [])] };
    } catch {
      // unreadable state ⇒ start over (baselines are re-seeded from the doc index)
    }
  }
  return { v: 1, iface: {}, estimates: [] };
}

/** Persist the state (call inside the workspace write queue). */
export function saveState(db: SqlDb, s: S9State): void {
  db.run("INSERT OR REPLACE INTO gen_meta (k, v) VALUES (?, ?)", [KEY, canonicalJson(s)]);
}

/** Fingerprints of the current index. */
export function fingerprints(ix: Pick<Indexer, "facts" | "modules">, hasher: Hasher): Fingerprints {
  const flowKeys: string[] = [];
  const schemaKeys: string[] = [];
  for (const f of ix.facts()) {
    if (f.kind === "route") flowKeys.push(`R ${f.method} ${f.pattern} ${f.handler ?? ""} ${f.path}`);
    else if (f.kind === "cli") flowKeys.push(`C ${f.command} ${f.path}`);
    else if (f.kind === "entry") flowKeys.push(`E ${f.entry} ${f.label} ${f.path}`);
    else if (f.kind === "schema") schemaKeys.push(`S ${f.entity} ${f.source} ${f.fields.join(",")} ${f.path}`);
  }
  const structure: string[] = [];
  for (const m of ix.modules()) {
    structure.push(`M ${m.id} ${m.membersDigest} ${m.parent ?? "-"}`);
    if (m.children.length > 0 && m.parent === undefined) structure.push(`I ${m.id} ${m.ifaceDigest}`);
  }
  const digest = (keys: string[]) => hasher.xxh3(keys.sort().join("\n"));
  return { flows: digest(flowKeys), schema: digest(schemaKeys), structure: digest(structure) };
}
