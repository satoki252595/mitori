// Build id in the daemon version handshake: `0.0.0+<build>` (daemon-client compares the whole
// string, so a rebuilt daemon counts as another version). Baked by `scripts/build-bin.ts`
// (`--define globalThis.__MITORI_BUILD__=…`) or passed by `scripts/start.ts` (`MITORI_BUILD`, inherited
// by the `_serve` child); unset for bare runs (`apps/cli/src/main.ts` directly, tests) ⇒ plain `0.0.0`.
declare global {
  /** Baked at compile time; unset in source runs. */
  var __MITORI_BUILD__: string | undefined;
}

/** Env var carrying the build id from `scripts/start.ts` (do not rename without updating it). */
export const BUILD_ENV = "MITORI_BUILD";
const VALID = /^[0-9a-f]{8,64}$/;

/** Short source hash when known, else undefined (behaviour stays `0.0.0`). */
export function currentBuild(): string | undefined {
  const raw = typeof globalThis.__MITORI_BUILD__ === "string" && globalThis.__MITORI_BUILD__ !== "" ? globalThis.__MITORI_BUILD__ : process.env[BUILD_ENV];
  return typeof raw === "string" && VALID.test(raw) ? raw : undefined;
}

/** `0.0.0+<build>` when a build id is known, else the base version unchanged. */
export function withBuild(version: string, build: string | undefined = currentBuild()): string {
  return build === undefined || version.includes("+") ? version : `${version}+${build}`;
}
