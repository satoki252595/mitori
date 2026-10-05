import { expect, test } from "bun:test";
import { checkVerdict, runCheckStep, runCheckSteps } from "./check.ts";

test("check preserves the 30s reference boundary, scales CI time only, and still fails actual broken steps", async () => {
  expect(checkVerdict(30, 0)).toEqual({ target: 15, limit: 30, exitCode: 0 });
  expect(checkVerdict(30.001, 0, 1).exitCode).toBe(1);
  expect(checkVerdict(60, 0, 2)).toEqual({ target: 30, limit: 60, exitCode: 0 });
  expect(checkVerdict(60.001, 0, 2).exitCode).toBe(1);
  const step = await runCheckStep("broken", ["bun", "-e", "process.exit(7)"]);
  expect(step.code).toBe(7);
  expect(checkVerdict(step.ms / 1000, step.code === 0 ? 0 : 1, 5).exitCode).toBe(1);
});

test("bounded checks keep every task and failure while capping concurrent work", async () => {
  let active = 0;
  let peak = 0;
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  const steps: [string, string[]][] = ["tsc", "svelte-check", "broken", "after-failure"].map((name) => [name, []]);
  const pending = runCheckSteps(steps, 2, async (name) => {
    started.push(name);
    peak = Math.max(peak, ++active);
    await hold;
    active--;
    return { name, code: name === "broken" ? 7 : 0, ms: 0, log: "" };
  });
  expect(started).toEqual(["tsc", "svelte-check"]);
  release();
  const results = await pending;
  expect(peak).toBe(2);
  expect(started).toEqual(steps.map(([name]) => name));
  expect(results.map(({ name }) => name)).toEqual(started);
  expect(checkVerdict(0, results.filter(({ code }) => code !== 0).length, 5).exitCode).toBe(1);
  expect((await runCheckSteps([["one", []]], 0, async (name) => ({ name, code: 0, ms: 0, log: "" }))).map(({ name }) => name)).toEqual(["one"]);
});
