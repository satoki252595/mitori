import { expect, test } from "bun:test";
import { parseCsvLine } from "../src/csv.ts";

test("parseCsvLine keeps commas inside quotes", () => {
  expect(parseCsvLine('INV-1,"Tokyo, Japan",1200')).toEqual(["INV-1", "Tokyo, Japan", "1200"]);
  expect(parseCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  expect(parseCsvLine("")).toEqual([""]);
});
