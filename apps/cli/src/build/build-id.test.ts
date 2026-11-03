/** WP15 続き: 版識別子 `<version>+<build>`（daemon-client が文字列全体で比べる。`9.9.9` は任意の基底版）。 */
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
    expect(withBuild("9.9.9", undefined)).toBe("9.9.9");
    expect(withBuild("9.9.9", "abc12345")).toBe("9.9.9+abc12345");
    expect(withBuild("9.9.9+old", "abc12345")).toBe("9.9.9+old");
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
    expect(withBuild("9.9.9")).toBe("9.9.9");
  });
});
