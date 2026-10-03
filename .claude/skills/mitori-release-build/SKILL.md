---
name: mitori-release-build
description: Build, size-gate and smoke-test mitori's single binary (bun build --compile with embedded web shell, grammar wasm, Workers, ELK, Shiki), or cut release tarballs for darwin-arm64 + linux-x64. Use when asked to "build the binary", "check the binary size", "run the skeleton test", "make a release", or after bumping a pinned wasm/grammar/ELK/Shiki package.
---

# mitori-release-build

Always run tools through `scripts/nd` (cached nix devShell; never `nix develop`). Details and measurements:
`apps/cli/BUILD-NOTES.md`.

1. `scripts/nd bun run build:bin [--target darwin-arm64|linux-x64|all]` — verifies
   `apps/cli/src/build/assets.lock.json` (sha256 + size + package version; any mismatch fails before compiling),
   brotli-packs the pinned files, builds/precompresses the web dist, compiles → `dist/mitori-<os>-<arch>`.
   Host target by default; `all` downloads the other Bun runtime.
2. `scripts/nd bun run size` — `bin.size` gate per built target (target = warning, limit 95 MB = failure) and the
   served web bytes (`bench/asset/size.ts`, once WP-12 lands it).
3. `scripts/nd bun test test/skeleton` — acceptance on the compiled binary copied into a dir without node_modules
   (health ≤ 1 s, shell served, no `.env`/`bunfig.toml` autoload, no test hooks in the release build).
4. Release: `scripts/nd bun scripts/release.ts [--out dist/release]` — both targets + size gate +
   `mitori-<version>-<target>.tar.gz` + `SHA256SUMS` + `release.json`. Never upload/publish without the user's yes.

After bumping a pinned package (web-tree-sitter, tree-sitter-*, elkjs, shiki/@shikijs/*):
`scripts/nd bun scripts/gen-assets.ts --update-lock`, review the lock diff (sizes and hashes of every changed file),
then steps 1–3. `scripts/nd bun scripts/gen-assets.ts --verify-only` checks the lock without building.

Failure hints: a lock mismatch means node_modules differs from `bun.lock` (`scripts/nd bun install --frozen-lockfile`);
over-target size on linux-x64 is expected headroom pressure (Bun's runtime floor is 81 MB there), over-limit is a bug.
