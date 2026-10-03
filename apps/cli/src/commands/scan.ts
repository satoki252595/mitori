/** `mitori scan [--force]`: re-scan the workspace (S0–S4, no tokens) and wait for the summary line. */
import type { ScanStatus } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { parse } from "./args.ts";
import { type Io, usage } from "./io.ts";
import { connectWorkspace } from "./session.ts";
import { whenReady } from "./workspace.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT_MS = 10 * 60_000;

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(io.argv, { force: { type: "boolean" } }, "scan");
  if (positionals.length > 0) throw usage(`unexpected argument ${positionals[0]}`, "mitori scan --help");
  const s = await connectWorkspace(io);
  const ws = s.ws.info.key;
  await whenReady(io, () => s.api.call("POST /ws/:ws/scan", { params: { ws }, body: values.force ? { force: true } : {} }));
  const until = io.clock.now() + MAX_WAIT_MS;
  let st: ScanStatus;
  do {
    await sleep(100);
    st = await whenReady(io, () => s.api.call("GET /ws/:ws/scan", { params: { ws } }));
  } while (st.state === "running" && io.clock.now() < until);
  if (st.state === "failed") throw MitoriError.from(st.error ?? new MitoriError("E_INTERNAL", "the scan failed"));
  const sum = st.summary;
  io.out(
    sum ? `${s.ws.info.name}: ${sum.files} files · ${sum.loc} LOC · ${sum.modules} modules · ${Math.round(sum.ms)} ms\n` : `${s.ws.info.name}: ${st.state}\n`,
  );
  return 0;
}
