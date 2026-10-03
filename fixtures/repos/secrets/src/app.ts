import { totals } from "./billing.ts";
import { loadConfig } from "./config.ts";

/** Entry point: print the totals of a demo invoice list. */
export function main(): void {
  const config = loadConfig();
  console.log(`database at ${new URL(config.databaseUrl).host}`);
  console.log(totals([{ id: "INV-2026-0001", amount: 12_000, currency: "JPY" }]));
}

main();
