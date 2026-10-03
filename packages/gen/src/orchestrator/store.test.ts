import { describe, expect, test } from "bun:test";
import { memDb, testClock } from "../test/ports.ts";
import { GEN_MIGRATIONS } from "./index.ts";
import { GenStore } from "./store.ts";

describe("gen_outputs GC (§3.8)", () => {
  test("beyond the byte budget the least recently used outputs are deleted; the new one stays", () => {
    const clock = testClock();
    const store = new GenStore(memDb(GEN_MIGRATIONS), clock);
    const out = (s: string) => ({ lines: [s.repeat(40)], idMap: {} });
    const budget = 3 * JSON.stringify([`${"x".repeat(40)}`]).length;
    store.putOutput("k1", "gen.module@1", "m", out("a"), budget);
    clock.advance(1000);
    store.putOutput("k2", "gen.module@1", "m", out("b"), budget);
    clock.advance(1000);
    store.putOutput("k3", "gen.module@1", "m", out("c"), budget);
    clock.advance(1000);
    store.touchOutput("k1"); // k1 was used recently ⇒ k2 is now the oldest
    clock.advance(1000);
    store.putOutput("k4", "gen.module@1", "m", out("d"), budget);
    expect(["k1", "k2", "k3", "k4"].map((k) => store.getOutput(k) !== null)).toEqual([true, false, true, true]);
  });
});
