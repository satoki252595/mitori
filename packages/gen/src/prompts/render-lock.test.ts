import { describe, expect, test } from "bun:test";
import { canonicalJson } from "@mitori/core";
import { makeHarness } from "../test/harness.ts";

/**
 * AC-40 for the renderer's formats (§5.1-1: "template bytes … or the renderer's formats"): the exact system + user
 * bytes of every M2 prompt over the sample repo are hashed into `render.lock.json`. A failure means a DATA format,
 * fence or template byte changed: bump the prompt / system version, then rewrite the lock with
 * `MITORI_UPDATE_GOLDEN=1 bun test packages/gen/src/prompts/render-lock.test.ts` in a `golden:` commit.
 */
async function renderedCalls(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const effort of ["standard", "overview"] as const) {
    const h = makeHarness();
    await h.gen.start((await h.gen.estimate({ effort })).id);
    await h.gen.idle();
    for (const c of h.engine.calls) {
      const target = /module (md_\w{8})/.exec(c.call.layout.unit)?.[1] ?? "-";
      const key = `${effort} ${c.call.spec.version}${c.call.mode ? `:${c.call.mode}` : ""} ${target} #${c.call.attempt}`;
      out[key] = h.hasher.sha256(`${c.system}\n\0\n${c.call.layout.unit}`);
    }
  }
  return out;
}

describe("AC-40 rendered prompt bytes are locked per version", () => {
  test("system + user message of every M2 prompt (sample repo) match render.lock.json", async () => {
    const actual = await renderedCalls();
    const url = new URL("./render.lock.json", import.meta.url);
    if (process.env.MITORI_UPDATE_GOLDEN === "1") await Bun.write(url, canonicalJson(actual));
    const locked = (await Bun.file(url).json()) as Record<string, string>;
    expect(Object.keys(actual).length).toBeGreaterThanOrEqual(13);
    expect(actual).toEqual(locked);
  });
});
