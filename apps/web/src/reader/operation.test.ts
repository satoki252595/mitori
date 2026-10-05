import { expect, test } from "bun:test";
import type { BlockOpRes, Estimate } from "@mitori/core";
import { confirmDocOperation } from "./operation.ts";

test("document operations never start on an estimate, cancellation, or a cache hit", async () => {
  const estimate = { apiUsd: 0.02, inTokens: 300 } as Estimate;
  const calls: boolean[] = [];
  const call = async (confirm: boolean): Promise<BlockOpRes> => {
    calls.push(confirm);
    return confirm ? { cached: false, run: "gr_123" as never } : { cached: false, estimate };
  };
  expect(await confirmDocOperation(call, () => false)).toBeNull();
  expect(calls).toEqual([false]);
  calls.length = 0;
  expect((await confirmDocOperation(call, () => true))?.run).toBe("gr_123" as never);
  expect(calls).toEqual([false, true]);
  let confirmed = false;
  expect(
    await confirmDocOperation(
      async () => ({ cached: true }),
      () => {
        confirmed = true;
        return true;
      },
    ),
  ).toEqual({ cached: true });
  expect(confirmed).toBe(false);
});
