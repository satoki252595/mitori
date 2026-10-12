/** WP15 続き: 古い CLI が新しい daemon を巻き戻さない（`cliMayRestart` の純粋判定）。 */
import { describe, expect, test } from "bun:test";
import { cliMayRestart } from "./daemon-client.ts";

describe("cliMayRestart (stale-CLI guard)", () => {
  test("only a CLI started strictly after the daemon may restart it", () => {
    expect(cliMayRestart("2026-10-05T00:00:00.000Z", "2026-10-04T00:00:00.000Z")).toBe(true);
    expect(cliMayRestart("2026-10-04T00:00:00.000Z", "2026-10-04T00:00:00.000Z")).toBe(false);
    expect(cliMayRestart("2026-10-03T00:00:00.000Z", "2026-10-04T00:00:00.000Z")).toBe(false);
  });

  test("missing or unparseable times never allow a restart", () => {
    expect(cliMayRestart(undefined, "2026-10-04T00:00:00.000Z")).toBe(false);
    expect(cliMayRestart("2026-10-05T00:00:00.000Z", undefined)).toBe(false);
    expect(cliMayRestart(undefined, undefined)).toBe(false);
    expect(cliMayRestart("garbage", "2026-10-04T00:00:00.000Z")).toBe(false);
    expect(cliMayRestart("2026-10-05T00:00:00.000Z", "garbage")).toBe(false);
  });
});
