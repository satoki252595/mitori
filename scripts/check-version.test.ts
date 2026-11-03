import { describe, expect, test } from "bun:test";
import { checkVersions } from "./check-version.ts";

describe("WP37 version canonical", () => {
  test("WP37 version mismatch is reported", () => {
    expect(checkVersions({ root: "0.1.0", cli: "0.2.0" })).toHaveLength(1);
    expect(checkVersions({ root: "0.1.0", cli: "0.1.0" })).toEqual([]);
  });

  test("WP37 committed manifests agree and cli reports 0.1.0", async () => {
    const root = (await Bun.file("package.json").json()) as { version: string };
    const cli = (await Bun.file("apps/cli/package.json").json()) as { version: string };
    expect(checkVersions({ root: root.version, cli: cli.version })).toEqual([]);
    expect(cli.version).toBe("0.1.0");
    const { cliVersion } = await import("../apps/cli/src/main.ts");
    expect(cliVersion().startsWith("0.1.0")).toBe(true);
  });
});
