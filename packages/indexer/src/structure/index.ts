/**
 * @mitori/indexer — `structure/` (owner: WP-03). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files (stage functions live in `stage.ts`, used by WP-02's
 * facade through relative imports).
 */
import { base32, type ModuleId, type RepoPath, type Xxh3 } from "@mitori/core";
import { SLUG_NOISE_SEGMENTS } from "../contract.ts";
import { slugText } from "./slug.ts";

/** xxh3 hex (16 chars) → 8 big-endian bytes. */
function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  return out;
}

/** Deterministic module id: `md_` + base32(xxh3(`md|<anchor>|<n>`))[0:8] (spec §6.6). */
export function moduleIdFor(anchor: RepoPath, n: number, xxh3: (s: string) => Xxh3): ModuleId {
  return `md_${base32(hexBytes(xxh3(`md|${anchor}|${n}`))).slice(0, 8)}`;
}

/** Module slug from a dominant directory / anchor stem (spec §6.6). */
export function slugify(dominantDir: string, anchor: RepoPath): string {
  const file = anchor.slice(anchor.lastIndexOf("/") + 1);
  const stem = file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file;
  if (dominantDir === "" || dominantDir === ".") return slugText(stem) || "module";
  const segs = dominantDir.split("/").filter(Boolean);
  const kept = segs.filter((s) => !(SLUG_NOISE_SEGMENTS as readonly string[]).includes(s));
  return slugText((kept.length > 0 ? kept : segs).slice(-3).join("-")) || slugText(stem) || "module";
}
