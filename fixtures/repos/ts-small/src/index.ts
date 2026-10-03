import { loadConfig } from "./config.ts";

/** Entry point: report where the service listens. */
export function main(): void {
  const config = loadConfig();
  console.log(`tsundoku listening on :${config.port}`);
}

main();
