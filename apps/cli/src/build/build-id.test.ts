/** WP15 続き: 版識別子 `0.0.0+<build>`（daemon-client が文字列全体で比べる）。 */
import { afterEach, describe, expect, test } from "bun:test";
import { BUILD_ENV, currentBuild, withBuild } from "./build-id.ts";

const savedEnv = process.env[BUILD_ENV];
const savedGlobal = globalThis.__MITORI_BUILD__;
afterEach(() => {
  if (savedEnv === undefined) delete process.env[BUILD_ENV];
  else process.env[BUILD_ENV] = savedEnv;
  globalThis.__MITORI_BUILD__ = savedGlobal;
});

describe("build id in the version handshake", () => {
  test("withBuild appends the id, and leaves plain or already-suffixed versions alone", () => {
    expect(withBuild("0.0.0", undefined)).toBe("0.0.0");
    expect(withBuild("0.0.0", "abc12345")).toBe("0.0.0+abc12345");
    expect(withBuild("0.0.0+old", "abc12345")).toBe("0.0.0+old");
  });

  test("currentBuild prefers the baked id, then the env, and ignores garbage", () => {
    delete process.env[BUILD_ENV];
    globalThis.__MITORI_BUILD__ = undefined;
    expect(currentBuild()).toBeUndefined();
    process.env[BUILD_ENV] = "abc12345def0";
    expect(currentBuild()).toBe("abc12345def0");
    globalThis.__MITORI_BUILD__ = "001122334455";
    expect(currentBuild()).toBe("001122334455");
    globalThis.__MITORI_BUILD__ = undefined;
    process.env[BUILD_ENV] = "not a hash!!";
    expect(currentBuild()).toBeUndefined();
    expect(withBuild("0.0.0")).toBe("0.0.0");
  });
});
