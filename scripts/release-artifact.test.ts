import { describe, expect, test } from "bun:test";
import { TARGETS } from "./build-bin.ts";
import { archiveName, binName, stageName } from "./release.ts";

describe("WP37 release artifacts", () => {
  test("WP37 TARGETS covers the four release targets", () => {
    expect([...TARGETS].sort()).toEqual(["darwin-arm64", "linux-arm64", "linux-x64", "windows-x64"]);
  });

  test("WP37 archive and stage names use zip for windows and tar.gz otherwise", () => {
    expect(archiveName("windows-x64", "0.1.0")).toBe("mitori-0.1.0-windows-x64.zip");
    expect(stageName("windows-x64")).toBe("mitori.exe");
    expect(binName("windows-x64")).toBe("mitori-windows-x64.exe");
    expect(archiveName("linux-x64", "0.1.0")).toBe("mitori-0.1.0-linux-x64.tar.gz");
    expect(archiveName("linux-arm64", "0.1.0")).toBe("mitori-0.1.0-linux-arm64.tar.gz");
    expect(archiveName("darwin-arm64", "0.1.0")).toBe("mitori-0.1.0-darwin-arm64.tar.gz");
    expect(stageName("linux-arm64")).toBe("mitori");
    expect(binName("linux-arm64")).toBe("mitori-linux-arm64");
  });
});
