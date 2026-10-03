/**
 * Module identity across scans (spec §6.6): LOC-weighted Jaccard matching against the previous alive modules,
 * representative-path hits against tombstones and committed seeds (`doc.index.json`, CR idx-1), deterministic ids
 * for newborns, born-once slugs (SLUG_RE validated, SEC-01), split lineage and tombstones.
 */
import { type Iso8601, type ModuleId, type RepoPath, SLUG_RE } from "@mitori/core";
import { STRUCTURE_PARAMS } from "../contract.ts";
import { moduleIdFor, slugify } from "./index.ts";
import { slugText } from "./slug.ts";

/** A module known from the previous state (DB rows or seeds). */
export interface PrevModule {
  id: ModuleId;
  slug: string;
  name: string;
  parent?: ModuleId;
  /** Leaf (true) or parent level. */
  leaf: boolean;
  alive: boolean;
  /** Non-test member paths (for parents: the union of their leaves); empty when unknown (tombstones, seeds). */
  members: readonly RepoPath[];
  /** Representative paths (≤ 32). */
  reps: readonly RepoPath[];
  anchor: RepoPath;
  /** LOC at the last scan (size-range checks of the refresh, spec §6.8). */
  loc?: number;
  bornAt: Iso8601;
  deadAt?: Iso8601;
  splitFrom?: ModuleId;
  /** Previous-state row was a seed (no DB history). */
  seed?: boolean;
}

/** A community of the current scan, before it has an identity. */
export interface Community {
  members: readonly RepoPath[];
  anchor: RepoPath;
  dominantDir: string;
  /** Provisional display name (used only when born). */
  name: string;
  leaf: boolean;
}

export interface Identity {
  id: ModuleId;
  slug: string;
  name: string;
  anchor: RepoPath;
  bornAt: Iso8601;
  splitFrom?: ModuleId;
  /** The previous module it continues (null = newborn). */
  from: ModuleId | null;
}

export interface IdentityContext {
  /** Current LOC of a path (0 when unknown / deleted). */
  loc(path: RepoPath): number;
  /** Paths present in this snapshot (seed / tombstone hit denominators). */
  exists(path: RepoPath): boolean;
  xxh3(s: string): string;
  now: Iso8601;
  /** Ids and slugs that must never be reused (alive + tombstones + seeds of every level). */
  takenIds: Set<string>;
  takenSlugs: Set<string>;
  /** Repo settings `modules[<prefix>]` overrides. */
  overrides?: Readonly<Record<RepoPath, { name?: string; slug?: string }>>;
  /** Notices (`notice.slug.rewritten`, settings conflicts). */
  notices: string[];
}

/** LOC-weighted Jaccard of two path sets. */
function jaccard(a: readonly RepoPath[], b: ReadonlySet<RepoPath>, ctx: IdentityContext): number {
  let inter = 0;
  let union = 0;
  const w = (p: RepoPath) => Math.max(1, ctx.loc(p));
  const seen = new Set<RepoPath>();
  for (const p of a) {
    seen.add(p);
    union += w(p);
    if (b.has(p)) inter += w(p);
  }
  for (const p of b) if (!seen.has(p)) union += w(p);
  return union === 0 ? 0 : inter / union;
}

/** Representative hit ratio |reps ∩ c| / |reps ∩ existing| (seeds, tombstones). */
function hit(reps: readonly RepoPath[], c: ReadonlySet<RepoPath>, ctx: IdentityContext): number {
  let present = 0;
  let inC = 0;
  for (const r of reps) {
    if (!ctx.exists(r)) continue;
    present++;
    if (c.has(r)) inC++;
  }
  return present === 0 ? 0 : inC / present;
}

/** Longest `modules[<prefix>]` override whose prefix contains the dominant dir. */
function overrideFor(dir: string, ctx: IdentityContext): { name?: string; slug?: string } | undefined {
  let best: string | undefined;
  for (const p of Object.keys(ctx.overrides ?? {})) {
    const q = p.replace(/\/+$/, "");
    if ((dir === q || dir.startsWith(`${q}/`) || q === "" || q === ".") && (best === undefined || q.length > best.length)) best = q;
  }
  return best === undefined ? undefined : (ctx.overrides?.[best] ?? ctx.overrides?.[`${best}/`]);
}

/** Reserve a unique slug (`-2`, `-3` … within 48 chars). */
function uniqueSlug(base: string, ctx: IdentityContext): string {
  let s = base;
  for (let k = 2; ctx.takenSlugs.has(s); k++) {
    const suffix = `-${k}`;
    s = `${base.slice(0, 48 - suffix.length).replace(/-+$/, "")}${suffix}`;
  }
  ctx.takenSlugs.add(s);
  return s;
}

/**
 * Give every community an identity. `prev` = previous modules of the same level (alive + tombstones), or the seeds
 * when the index has no modules yet. Returns identities (parallel to `comms`) and the previous modules left over
 * (to be tombstoned by the caller).
 */
export function assignIdentities(comms: readonly Community[], prev: readonly PrevModule[], ctx: IdentityContext): { ids: Identity[]; unmatched: PrevModule[] } {
  const P = STRUCTURE_PARAMS;
  const sets = comms.map((c) => new Set(c.members));
  type Cand = { c: number; o: number; score: number };
  const cands: Cand[] = [];
  const memberIndex = new Map<RepoPath, number>();
  comms.forEach((c, i) => {
    for (const p of c.members) memberIndex.set(p, i);
  });
  prev.forEach((o, oi) => {
    const touching = new Set<number>();
    for (const p of o.members.length > 0 ? o.members : o.reps) {
      const c = memberIndex.get(p);
      if (c !== undefined) touching.add(c);
    }
    for (const ci of touching) {
      const set = sets[ci] as Set<RepoPath>;
      const score = o.alive && o.members.length > 0 && !o.seed ? jaccard(o.members, set, ctx) : hit(o.reps, set, ctx);
      if (score > 0) cands.push({ c: ci, o: oi, score });
    }
  });
  // alive modules (Jaccard) are matched before tombstones (representative hits): the two scores are not comparable,
  // and letting a tombstone's hit 1.0 beat an alive J 0.97 makes two ids swap back and forth across refreshes
  cands.sort((a, b) => {
    const pa = prev[a.o] as PrevModule;
    const pb = prev[b.o] as PrevModule;
    return (
      Number(pb.alive) - Number(pa.alive) ||
      b.score - a.score ||
      (pa.id < pb.id ? -1 : pa.id > pb.id ? 1 : 0) ||
      ((comms[a.c] as Community).anchor < (comms[b.c] as Community).anchor ? -1 : 1)
    );
  });
  const cTaken = new Int32Array(comms.length).fill(-1);
  const oTaken = new Int32Array(prev.length).fill(-1);
  for (const k of cands) {
    const threshold = (prev[k.o] as PrevModule).seed ? P.seedHit : P.jaccardMatch;
    if (k.score < threshold || cTaken[k.c] !== -1 || oTaken[k.o] !== -1) continue;
    cTaken[k.c] = k.o;
    oTaken[k.o] = k.c;
  }
  const ids: Identity[] = comms.map((c, ci) => {
    const oi = cTaken[ci] as number;
    if (oi >= 0) {
      const o = prev[oi] as PrevModule;
      let slug = o.slug;
      if (!SLUG_RE.test(slug)) {
        ctx.notices.push(`notice.slug.rewritten ${o.id} ${JSON.stringify(slug)}`);
        ctx.takenSlugs.delete(slug);
        slug = uniqueSlug(slugText(slug) || slugify(c.dominantDir, c.anchor), ctx);
      } else ctx.takenSlugs.add(slug);
      return {
        id: o.id,
        slug,
        name: o.name,
        anchor: o.seed ? c.anchor : o.anchor,
        bornAt: o.seed ? ctx.now : o.bornAt,
        from: o.id,
        ...(o.splitFrom ? { splitFrom: o.splitFrom } : {}),
      };
    }
    return null as unknown as Identity;
  });
  // newborns, in community order (deterministic id/slug assignment)
  comms.forEach((c, ci) => {
    if (ids[ci] !== null) return;
    let id: ModuleId = moduleIdFor(c.anchor, 0, ctx.xxh3);
    for (let k = 1; ctx.takenIds.has(id); k++) id = moduleIdFor(c.anchor, k, ctx.xxh3);
    ctx.takenIds.add(id);
    const ov = overrideFor(c.dominantDir, ctx);
    let base = slugify(c.dominantDir, c.anchor);
    if (ov?.slug !== undefined) {
      if (SLUG_RE.test(ov.slug) && !ctx.takenSlugs.has(ov.slug)) base = ov.slug;
      else ctx.notices.push(`notice.slug.rewritten settings ${JSON.stringify(ov.slug)}`);
    }
    const slug = uniqueSlug(base, ctx);
    // lineage: the largest earlier module this community overlaps (J ≥ 0.3) that went to another community
    let splitFrom: ModuleId | undefined;
    let bestScore = 0;
    for (const k of cands)
      if (k.c === ci && k.score >= P.splitLineage && k.score > bestScore && (oTaken[k.o] as number) >= 0) {
        splitFrom = (prev[k.o] as PrevModule).id;
        bestScore = k.score;
      }
    ids[ci] = { id, slug, name: ov?.name ?? c.name, anchor: c.anchor, bornAt: ctx.now, from: null, ...(splitFrom ? { splitFrom } : {}) };
  });
  return { ids, unmatched: prev.filter((_, oi) => oTaken[oi] === -1) };
}
