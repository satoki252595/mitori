import { loadConfig } from "./config.ts";
import { createApp } from "./http/routes.ts";

/** Pick `--port <n>` out of the command line, if present and numeric. */
function portFlag(argv: readonly string[]): number | undefined {
  const at = argv.indexOf("--port");
  const n = at >= 0 ? Number(argv[at + 1]) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Entry point: start the HTTP service. */
export function main(argv: readonly string[] = Bun.argv.slice(2)): void {
  const config = loadConfig();
  const port = portFlag(argv) ?? config.port;
  const app = createApp();
  Bun.serve({ port, fetch: app.fetch });
  console.log(`tsundoku listening on :${port} (log level ${config.logLevel})`);
}

main();
