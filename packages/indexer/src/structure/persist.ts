/**
 * Module identity persistence (spec §9 `idx_modules` / `idx_module_members` / `idx_meta`; migrations are WP-02's
 * `INDEXER_MIGRATIONS`). Representative paths and the leaf/parent level are kept in `idx_meta` (`structure.extra`)
 * so that tombstones can be resurrected without their member rows. The facade runs `saveStructure` in the write queue.
 */
import type { Iso8601, ModuleId, RepoPath, SqlDb } from "@mitori/core";
import { INDEXER_FORMAT } from "../contract.ts";
import type { PrevModule } from "./identity.ts";
import type { StructurePrev, StructureResult, TombstoneDetail } from "./stage.ts";

interface ModuleRow {
  id: string;
  slug: string;
  name: string;
  parent: string | null;
  alive: number;
  loc: number;
  anchor: string;
  split_from: string | null;
  born_at: string;
  dead_at: string | null;
}

interface Extra {
  reps: RepoPath[];
  leaf: boolean;
}

const META_EXTRA = "structure.extra";
const META_GAMMA = "leiden_gamma";
const META_VERSION = "structure_version";
const META_BASE = "structure.base";

function meta(db: SqlDb, k: string): string | null {
  return db.get<{ v: string }>("SELECT v FROM idx_meta WHERE k = ?", [k])?.v ?? null;
}

/** Previous structure (empty when the index has no modules yet → seeds apply). */
export function loadStructure(db: SqlDb): StructurePrev {
  const rows = db.all<ModuleRow>("SELECT id, slug, name, parent, alive, loc, anchor, split_from, born_at, dead_at FROM idx_modules ORDER BY id");
  if (rows.length === 0) return { modules: [] };
  const extra = JSON.parse(meta(db, META_EXTRA) ?? "{}") as Record<string, Extra>;
  const members = new Map<string, RepoPath[]>();
  for (const m of db.all<{ path: string; module: string }>("SELECT path, module FROM idx_module_members WHERE role = 'member' ORDER BY path")) {
    const list = members.get(m.module);
    if (list) list.push(m.path);
    else members.set(m.module, [m.path]);
  }
  const children = new Map<string, string[]>();
  for (const r of rows) if (r.parent !== null) children.set(r.parent, [...(children.get(r.parent) ?? []), r.id]);
  const allMembers = (id: string, hops = 0): RepoPath[] =>
    hops > 4 ? [] : [...(members.get(id) ?? []), ...(children.get(id) ?? []).flatMap((c) => allMembers(c, hops + 1))];
  const modules: PrevModule[] = rows.map((r) => {
    const x = extra[r.id];
    const leaf = x?.leaf ?? members.has(r.id);
    return {
      id: r.id as ModuleId,
      slug: r.slug,
      name: r.name,
      ...(r.parent !== null ? { parent: r.parent as ModuleId } : {}),
      leaf,
      alive: r.alive === 1,
      members: r.alive === 1 ? allMembers(r.id).sort() : [],
      reps: x?.reps ?? [],
      anchor: r.anchor,
      loc: r.loc,
      bornAt: r.born_at as Iso8601,
      ...(r.dead_at !== null ? { deadAt: r.dead_at as Iso8601 } : {}),
      ...(r.split_from !== null ? { splitFrom: r.split_from as ModuleId } : {}),
    };
  });
  const g = meta(db, META_GAMMA);
  const sameVersion = meta(db, META_VERSION) === String(INDEXER_FORMAT.structure);
  const base = meta(db, META_BASE);
  return {
    modules,
    ...(g !== null && sameVersion ? { gamma: Number(g) } : {}),
    ...(base !== null && sameVersion ? { base: new Map(Object.entries(JSON.parse(base) as Record<string, string>)) } : {}),
  };
}

/** Replace the persisted structure with `r` (one IMMEDIATE transaction; call it through the write queue). */
export function saveStructure(db: SqlDb, r: StructureResult, now: Iso8601): void {
  db.tx(() => {
    db.run("DELETE FROM idx_module_members");
    db.run("DELETE FROM idx_modules");
    const extra: Record<string, Extra> = {};
    const leafIds = new Set(r.modules.filter((m) => m.paths.length > 0).map((m) => m.id));
    const rows: (StructureResult["modules"][number] | TombstoneDetail)[] = [...r.modules, ...r.tombstones];
    for (const m of rows) {
      const dead = "deadAt" in m ? m.deadAt : null;
      db.run(
        `INSERT INTO idx_modules (id, slug, name, parent, depth, alive, loc, rank, topo, cross_cutting, dominant_dir, anchor,
          members_digest, iface_digest, body_digest, facts_digest, tests_digest, split_from, oversize_file, born_at, dead_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          m.slug,
          m.name,
          m.parent ?? null,
          m.depth,
          m.alive ? 1 : 0,
          m.loc,
          m.rank,
          m.topoOrder,
          m.crossCutting ? 1 : 0,
          m.dominantDir,
          m.anchor,
          m.membersDigest,
          m.ifaceDigest,
          m.bodyDigest,
          m.factsDigest,
          m.testsDigest,
          m.splitFrom ?? null,
          m.oversizeFile ? 1 : 0,
          m.bornAt,
          dead,
          now,
        ],
      );
      extra[m.id] = { reps: m.reps, leaf: "leaf" in m ? m.leaf : leafIds.has(m.id) };
    }
    for (const m of r.modules) {
      for (const p of m.paths) db.run("INSERT INTO idx_module_members (path, module, role) VALUES (?, ?, 'member')", [p, m.id]);
      for (const t of m.tests) db.run("INSERT OR IGNORE INTO idx_module_members (path, module, role) VALUES (?, ?, 'test')", [t, m.id]);
    }
    const put = (k: string, v: string) => db.run("INSERT INTO idx_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [k, v]);
    put(META_EXTRA, JSON.stringify(extra));
    put(META_GAMMA, String(r.info.gamma));
    put(META_VERSION, String(INDEXER_FORMAT.structure));
    put(META_BASE, JSON.stringify(Object.fromEntries([...r.base].sort(([a], [b]) => (a < b ? -1 : 1)))));
  });
}
