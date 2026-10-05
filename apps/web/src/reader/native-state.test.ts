import { expect, test } from "bun:test";
import type { BlockId } from "@mitori/core";
import { initialReaderWindow } from "./native-state.ts";

test("initial SSR window includes an offscreen hash block and both adjacent windows", () => {
  const order = Array.from({ length: 5000 }, (_, n) => `b_${n}` as BlockId);
  expect(initialReaderWindow(order, "b_4100", 50)).toEqual({ first: 81, last: 83 });
  expect(initialReaderWindow(order, "b_4999", 50)).toEqual({ first: 98, last: 99 });
  expect(initialReaderWindow(order, null, 50)).toEqual({ first: 0, last: 2 });
  expect(initialReaderWindow(order, "b_unknown", 50)).toEqual({ first: 0, last: 2 });
  expect(initialReaderWindow(order.slice(0, 2), "b_0", 50)).toEqual({ first: 0, last: 0 });
});
