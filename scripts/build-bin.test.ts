import { describe, expect, test } from "bun:test";
import { compileArgs } from "./build-bin.ts";

describe("WP37c build:bin compile args", () => {
  test("WP37c compileArgs pins the official runtime when given", () => {
    const args = compileArgs("e.ts", [], "linux-x64", "out", { executablePath: "/cache/bun-1.4.2-linux-x64/bun" });
    expect(args).toContain("--compile-executable-path=/cache/bun-1.4.2-linux-x64/bun");
  });

  test("WP37c compileArgs omits the runtime flag by default", () => {
    expect(compileArgs("e.ts", [], "linux-x64", "out").some((a) => a.startsWith("--compile-executable-path"))).toBe(false);
  });
});
