import { expect, test } from "bun:test";
import { checkVerdict, runCheckStep } from "./check.ts";

test("check preserves the 30s reference boundary, scales CI time only, and still fails actual broken steps", async () => {
  expect(checkVerdict(30, 0)).toEqual({ target: 15, limit: 30, exitCode: 0 });
  expect(checkVerdict(30.001, 0, 1).exitCode).toBe(1);
  expect(checkVerdict(60, 0, 2)).toEqual({ target: 30, limit: 60, exitCode: 0 });
  expect(checkVerdict(60.001, 0, 2).exitCode).toBe(1);
  const step = await runCheckStep("broken", ["bun", "-e", "process.exit(7)"]);
  expect(step.code).toBe(7);
  expect(checkVerdict(step.ms / 1000, step.code === 0 ? 0 : 1, 5).exitCode).toBe(1);
});
