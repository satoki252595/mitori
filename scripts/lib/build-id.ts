// Source build id for the daemon version handshake (WP15 の続き): `0.0.0+<build>`.
// `start.ts` computes it from the working tree and passes it to the CLI via `BUILD_ENV`;
// `build-bin.ts` bakes the same value into the compiled binary with `--define`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, ROOT } from "./repo.ts";

/** Env var carrying the build id from `start.ts` to the CLI it runs in-process (inherited by `_serve` children). */
export const BUILD_ENV = "MITORI_BUILD";
/** Short-hash length of the `+<build>` suffix. */
export const BUILD_ID_LEN = 12;

/** Source files the build id covers (mirrors the asset fingerprint in `start.ts`, minus tests). */
export function buildFileList(): string[] {
  return listFiles("apps", "packages", "scripts/gen-assets.ts", "scripts/start.ts", "package.json", "bun.lock", "bunfig.toml", "tsconfig*.json").filter(
    (p) => !/\.(test|spec)\.[^.]+$|\/(test|tests|__tests__)\//.test(p),
  );
}

/** Full source hash (the same bytes as `start.ts` `sourceFingerprint`). */
export function hashSources(root: string, files: readonly string[], runtime: string): string {
  const hash = createHash("sha256").update(runtime);
  for (const file of [...files].sort()) hash.update(`\0${file}\0`).update(readFileSync(join(root, file)));
  return hash.digest("hex");
}

/** Short build id for the working tree (same sources + same runtime ⇒ same value). */
export function sourceBuildId(runtime: string, root = ROOT, files: readonly string[] = buildFileList()): string {
  return hashSources(root, files, runtime).slice(0, BUILD_ID_LEN);
}
