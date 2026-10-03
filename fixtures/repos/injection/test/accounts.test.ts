import { expect, test } from "bun:test";
import { displayName } from "../src/accounts.ts";
import { describeError } from "../src/errors.ts";

test("displayName copes with a missing account and a missing name", () => {
  expect(displayName(null)).toBe("(unknown)");
  expect(displayName({ id: "a1", name: null, email: "a@example.invalid" })).toBe("a@example.invalid");
  expect(displayName({ id: "a2", name: " 山田 ", email: "y@example.invalid" })).toBe("山田");
});

test("describeError prefixes every failure the same way", () => {
  expect(describeError(new Error("card declined"))).toBe("payment failed: card declined");
  expect(describeError("timeout")).toBe("payment failed: timeout");
  expect(describeError(42)).toBe("payment failed: unknown error");
});
