/**
 * @mitori/anchor/testing — test-only helpers (fakes, conformance cases). Importable only from tests
 * (`*.test.ts`, `test/` dirs), bench, eval, e2e and @mitori/testkit; never from production sources
 * (scripts/check-boundaries.ts enforces it). Owner: the package's WP.
 */
import type { GitOid, Hasher, IndexDelta, LineNo, RepoPath, SymbolKey } from "@mitori/core";
import type { AnchorContext } from "./contract.ts";

/** Hasher over Bun's xxHash3 / CryptoHasher (same values as the platform hasher). */
export function testHasher(): Hasher {
  const enc = new TextEncoder();
  return {
    xxh3: (data) => Bun.hash.xxHash3(data).toString(16).padStart(16, "0"),
    sha256: (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
    gitBlob: (data, algo) => {
      const h = new Bun.CryptoHasher(algo);
      h.update(enc.encode(`blob ${data.length}\u0000`));
      h.update(data);
      return h.digest("hex");
    },
  };
}

/** Git blob id of a text (sha1 framing). */
export function blobOf(hasher: Hasher, text: string): GitOid {
  return hasher.gitBlob(new TextEncoder().encode(text), "sha1");
}

/** In-memory workspace for the anchor engine: a blob store (old texts / pins) plus the current tree. */
export interface MemWorkspace {
  /** Context passed to `AnchorEngine.reanchor`. */
  ctx: AnchorContext;
  /** Store a blob (pin) and return its id. */
  putBlob(text: string): GitOid;
  /** Forget a blob (pin missing ⇒ the cascade skips S3). */
  dropBlob(blob: GitOid): void;
  /** Replace the current tree; returns the delta from the previous tree (renames by identical blob). */
  commit(files: Readonly<Record<RepoPath, string>>, opts?: { renames?: { from: RepoPath; to: RepoPath }[] }): IndexDelta;
  /** Current blob of a path. */
  blob(path: RepoPath): GitOid | null;
}

/** Build a {@link MemWorkspace}. `symbols(path, text)` may supply enclosing-symbol lookups. */
export function memWorkspace(
  hasher: Hasher,
  initial: Readonly<Record<RepoPath, string>>,
  opts: { symbols?: (path: RepoPath, text: string, start: LineNo, end: LineNo) => SymbolKey | null } = {},
): MemWorkspace {
  const blobs = new Map<GitOid, string>();
  let tree = new Map<RepoPath, { blob: GitOid; text: string }>();
  let renames = new Map<RepoPath, RepoPath>();
  let added: RepoPath[] = [];
  const put = (text: string) => {
    const b = blobOf(hasher, text);
    blobs.set(b, text);
    return b;
  };
  for (const [p, t] of Object.entries(initial)) tree.set(p, { blob: put(t), text: t });
  const ctx: AnchorContext = {
    blobText: async (b) => blobs.get(b) ?? null,
    currentBlob: (p) => tree.get(p)?.blob ?? null,
    currentText: async (p) => tree.get(p)?.text ?? null,
    symbolRange: () => null,
    enclosingSymbol: (p, s, e) => {
      const f = tree.get(p);
      return f && opts.symbols ? opts.symbols(p, f.text, s, e) : null;
    },
    renamedTo: (p) => renames.get(p) ?? null,
    addedPaths: () => added,
    hasher,
  };
  return {
    ctx,
    putBlob: put,
    dropBlob: (b) => {
      blobs.delete(b);
    },
    blob: (p) => tree.get(p)?.blob ?? null,
    commit(files, o = {}) {
      const next = new Map<RepoPath, { blob: GitOid; text: string }>();
      for (const [p, t] of Object.entries(files)) next.set(p, { blob: put(t), text: t });
      const changed: IndexDelta["changed"] = [];
      for (const [p, f] of tree) if (next.get(p)?.blob !== f.blob) changed.push({ path: p, oldBlob: f.blob, newBlob: next.get(p)?.blob ?? null });
      for (const [p, f] of next) if (!tree.has(p)) changed.push({ path: p, oldBlob: null, newBlob: f.blob });
      const rn = o.renames ?? [];
      renames = new Map(rn.map((r) => [r.from, r.to]));
      added = changed.filter((c) => c.oldBlob === null).map((c) => c.path);
      tree = next;
      return {
        snapshot: {
          commit: null,
          tree: null,
          branch: null,
          dirty: true,
          indexDigest: hasher.xxh3([...next.values()].map((f) => f.blob).join()),
          takenAt: "2026-10-03T00:00:00.000Z",
        },
        changed,
        renames: rn,
        bodyOnly: [],
        symbols: [],
        ifaceChanged: [],
        membershipChanged: [],
        factsChanged: false,
        factKinds: [],
        structureRefreshed: false,
      };
    },
  };
}
