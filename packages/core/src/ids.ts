import { type BlockId, type DocId, type GlossaryId, type Hasher, ID_ALPHABET, ID_SPEC, type IdKind, type IdTypes, type Random } from "./domain.ts";
import { MitoriError } from "./errors.ts";

/** Lowercase Crockford base32 of bytes (no padding), alphabet {@link ID_ALPHABET}; MSB-first 5-bit groups. Pure. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ID_ALPHABET[(acc >>> bits) & 31];
    }
    acc &= (1 << bits) - 1; // keep only the unread bits (no overflow on long inputs)
  }
  if (bits > 0) out += ID_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

/**
 * New random id: `prefix + base32(r.bytes(ceil(len·5/8)))[:len]`. Pure given `r` [CR test-1].
 * The only sanctioned id source in doc/gen/loop/server/agent (ids, DATA-fence nonces, auth nonces use `r`).
 */
export function newId<K extends IdKind>(kind: K, r: Random): IdTypes[K] {
  const spec = ID_SPEC[kind];
  const n = Math.ceil((spec.len * 5) / 8);
  const bytes = r.bytes(n);
  if (bytes.length !== n) throw new MitoriError("E_INTERNAL", `Random.bytes(${n}) returned ${bytes.length} bytes`);
  return `${spec.prefix}${base32(bytes).slice(0, spec.len)}` as IdTypes[K];
}

/** xxh3 hex (16 chars) → its 8 big-endian bytes. */
function xxh3Bytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{16}$/.test(hex)) throw new MitoriError("E_INTERNAL", `Hasher.xxh3 must return 16 lowercase hex chars, got ${JSON.stringify(hex)}`);
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Deterministic id of a static/deterministic block [CONS-11]:
 * `"b_" + base32(xxh3(docId + "\u0000" + slot) as 8 big-endian bytes)[:8]`. The ONE formula used by
 * ADR-0004, `BlockMeta.slot` and gen §10.5. `docId` is minted on the first `applyStatic` / `mitori init`
 * (manifest skeleton), never at first generation, so static ids never change afterwards.
 */
export function staticBlockId(hasher: Hasher, docId: DocId, slot: string): BlockId {
  return `b_${base32(xxh3Bytes(hasher.xxh3(`${docId}\u0000${slot}`))).slice(0, ID_SPEC.block.len)}`;
}

/** Deterministic glossary id: `"gl_" + base32(xxh3(docId + "\u0000" + NFKC(lower(term))))[:8]` [CONS-34]. */
export function glossaryId(hasher: Hasher, docId: DocId, term: string): GlossaryId {
  const key = term.toLowerCase().normalize("NFKC");
  return `gl_${base32(xxh3Bytes(hasher.xxh3(`${docId}\u0000${key}`))).slice(0, ID_SPEC.glossary.len)}`;
}

const ID_BODY_RE = new RegExp(`^[${ID_ALPHABET}]+$`);

/** True when `id` is a well-formed id of `kind` (prefix, body length, alphabet). */
export function isId<K extends IdKind>(kind: K, id: unknown): id is IdTypes[K] {
  if (typeof id !== "string") return false;
  const { prefix, len } = ID_SPEC[kind];
  return id.length === prefix.length + len && id.startsWith(prefix) && ID_BODY_RE.test(id.slice(prefix.length));
}
