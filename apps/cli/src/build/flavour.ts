declare global {
  /** `false` in release binaries (`bun build --define globalThis.__MITORI_TEST__=false`); unset in source runs. */
  var __MITORI_TEST__: boolean | undefined;
}

/** `HealthRes.build` [CR test-6]: only a release build says `release`. */
export const BUILD_FLAVOUR: "release" | "test" = globalThis.__MITORI_TEST__ === false ? "release" : "test";
