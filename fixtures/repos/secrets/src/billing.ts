export interface Invoice {
  id: string;
  /** Amount in minor units (yen, cents). */
  amount: number;
  currency: "JPY" | "USD";
}

/** Sum of the amounts per currency. */
export function totals(invoices: readonly Invoice[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const invoice of invoices) out[invoice.currency] = (out[invoice.currency] ?? 0) + invoice.amount;
  return out;
}

/** Invoice ids must look like INV-2026-0001. */
export function isInvoiceId(value: string): boolean {
  return /^INV-\d{4}-\d{4}$/.test(value);
}
