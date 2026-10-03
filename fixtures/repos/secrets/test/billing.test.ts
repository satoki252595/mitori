import { expect, test } from "bun:test";
import { isInvoiceId, totals } from "../src/billing.ts";

test("totals sums per currency", () => {
  expect(
    totals([
      { id: "INV-2026-0001", amount: 1000, currency: "JPY" },
      { id: "INV-2026-0002", amount: 500, currency: "JPY" },
      { id: "INV-2026-0003", amount: 250, currency: "USD" },
    ]),
  ).toEqual({ JPY: 1500, USD: 250 });
});

test("isInvoiceId accepts only INV-YYYY-NNNN", () => {
  expect(isInvoiceId("INV-2026-0001")).toBe(true);
  expect(isInvoiceId("inv-2026-1")).toBe(false);
});
