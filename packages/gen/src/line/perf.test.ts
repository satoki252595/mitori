import { describe, expect, test } from "bun:test";
import type { SectionId } from "@mitori/core";
import type { ValidationContext } from "../contract.ts";
import { sectionAspects } from "./aspects.ts";
import { createLineValidator } from "./index.ts";

// §6.2: hand-written validator, ≤ 0.2 ms per line [仮]. Measured on realistic module-page lines.
describe("validator throughput", () => {
  test("≤ 0.2 ms per block line", () => {
    const ctx: ValidationContext = {
      prompt: "gen.module",
      form: "compact",
      lang: "ja",
      lineTypes: ["block", "module", "term", "question", "end"],
      primarySection: "s6/session" as SectionId,
      sections: ["s6/session"],
      aspectsOf: (s) => sectionAspects(s, "leaf"),
      existing: new Map(),
      modules: new Set(),
      citable: { lines: () => 400, allows: () => true },
      flows: { min: 0, max: 0 },
      requiredAspects: ["responsibility"],
      moduleLineRequired: false,
    };
    const md =
      "- `Store.Get` は ID からセッションを取り出し、期限切れなら `ErrExpired` を返す[[1]]。\n- `Store.Put` は新しいセッションを保存する[[2]]。\n- 並行アクセスは `sync.Mutex` で守る[[3]]。";
    const lines = Array.from({ length: 2000 }, (_, i) =>
      JSON.stringify({
        t: "block",
        id: `new:${(i % 999) + 1}`,
        aspect: "interface",
        md,
        claims: {
          "1": "behavior internal/session/store.go:40-58,store.go:70-72",
          "2": "behavior internal/session/store.go:60-71",
          "3": "invariant internal/session/store.go:12-20",
        },
      }),
    );
    const t0 = performance.now();
    for (let k = 0; k < 2; k++) {
      const v = createLineValidator(ctx);
      for (const [i, l] of lines.entries()) v.validate(l, i + 1);
    }
    const perLine = (performance.now() - t0) / (2 * lines.length);
    expect(perLine).toBeLessThan(0.2);
  });
});
