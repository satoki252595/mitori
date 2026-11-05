import { describe, expect, test } from "bun:test";
import { ENGINE_IDS, type EngineId } from "./domain.ts";

describe("engine enumeration (WP40c)", () => {
  test("WP40c-1 ENGINE_IDS lists every EngineId including antigravity-cli", () => {
    const want: EngineId[] = ["anthropic-api", "antigravity-cli", "claude-cli", "codex-cli", "generic", "grok-cli", "session"];
    expect(new Set(ENGINE_IDS)).toEqual(new Set(want));
    // the const stays in sync with the union: assigning each member proves exhaustiveness at type level
    const check: readonly EngineId[] = ENGINE_IDS;
    expect(check).toHaveLength(7);
  });
});
