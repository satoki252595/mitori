import { describe, expect, test } from "bun:test";
import { emaUpdate } from "./calibration.ts";
import { CALIBRATION } from "./domain.ts";
import { MitoriError } from "./errors.ts";

describe("emaUpdate [CR idx-7]", () => {
  test("first sample initializes (clamped), mad 0", () => {
    expect(emaUpdate(null, 1.3, CALIBRATION.kindClamp)).toEqual({ value: 1.3, n: 1, mad: 0 });
    expect(emaUpdate(null, 9, CALIBRATION.kindClamp)).toEqual({ value: 2, n: 1, mad: 0 });
    expect(emaUpdate({ value: 1, n: 0, mad: 0 }, 0.1, CALIBRATION.kindClamp)).toEqual({ value: 0.5, n: 1, mad: 0 });
  });

  test("value' = clamp((1−α)·value + α·sample); mad tracks relative deviation", () => {
    const s = emaUpdate({ value: 1, n: 4, mad: 0.1 }, 2, CALIBRATION.kindClamp);
    expect(s.value).toBeCloseTo(0.8 * 1 + 0.2 * 2, 12);
    expect(s.n).toBe(5);
    expect(s.mad).toBeCloseTo(0.8 * 0.1 + 0.2 * 1, 12);
    expect(emaUpdate({ value: 3.9, n: 9, mad: 0 }, 4, CALIBRATION.callClamp, 0.5).value).toBe(3.95);
    expect(emaUpdate({ value: 3.9, n: 9, mad: 0 }, 400, CALIBRATION.callClamp).value).toBe(4);
  });

  test("converges to a constant sample", () => {
    let s = emaUpdate(null, 1, CALIBRATION.kindClamp);
    for (let i = 0; i < 200; i++) s = emaUpdate(s, 1.5, CALIBRATION.kindClamp);
    expect(s.value).toBeCloseTo(1.5, 9);
    expect(s.mad).toBeLessThan(1e-9);
  });

  test("rejects non-positive / non-finite samples and bad parameters", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => emaUpdate(null, bad, CALIBRATION.kindClamp)).toThrow(MitoriError);
    expect(() => emaUpdate(null, 1, [2, 1])).toThrow(MitoriError);
    expect(() => emaUpdate(null, 1, CALIBRATION.kindClamp, 0)).toThrow(MitoriError);
  });
});
