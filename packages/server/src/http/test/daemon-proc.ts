/**
 * A real daemon in its own process for end-to-end tests that may not import the server (`@mitori/client` tests):
 * `bun daemon-proc.ts` with `MITORI_TEST_HOME=<dir>` starts the test harness daemon on that home (the port comes
 * from `srv_ports`, so a restart keeps it), prints one JSON line `{port, token, pid}` and stops gracefully on
 * SIGTERM / SIGINT (keeping the home, so sessions survive into the next start).
 */
import { startHarness } from "./harness.ts";

const home = process.env.MITORI_TEST_HOME;
if (!home) throw new Error("MITORI_TEST_HOME is required");
const h = await startHarness({ home });
console.log(JSON.stringify({ port: h.port, token: h.token, pid: process.pid }));
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await h.close({ keepHome: true });
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
