import { expect, test } from "bun:test";
import { applyTax, formatYen, toMinorUnits } from "../src/payments.ts";

test("toMinorUnits rounds half up without floats", () => {
  expect(toMinorUnits("1.005")).toBe(101);
  expect(toMinorUnits("1234.56")).toBe(123456);
  expect(toMinorUnits("-0.995")).toBe(-100);
  expect(toMinorUnits("5", 0)).toBe(5);
  expect(() => toMinorUnits("1,000")).toThrow(RangeError);
});

test("applyTax adds a rounded percentage", () => {
  expect(applyTax(1000, 10)).toBe(1100);
  expect(applyTax(1005, 8)).toBe(1085);
  expect(applyTax(1006, 5)).toBe(1056);
  expect(formatYen(applyTax(12000, 10))).toBe("¥13,200");
});
