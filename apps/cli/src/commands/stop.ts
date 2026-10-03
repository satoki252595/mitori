/**
 * `mitori stop`: `POST /daemon/shutdown` and wait until the process is gone (server spec §1.3: new jobs refused,
 * `server.shutdown` to the tabs, waiting `mitori review` calls released with `approved: false`, engines drained).
 */
import { parse } from "./args.ts";
import { findDaemon, stopDaemon } from "./daemon-client.ts";
import { type Io, usage } from "./io.ts";
import { homeOf } from "./session.ts";

export async function run(io: Io): Promise<number> {
  const { positionals } = parse(io.argv, {}, "stop");
  if (positionals.length > 0) throw usage(`unexpected argument ${positionals[0]}`, "mitori stop --help");
  const home = homeOf(io);
  const d = await findDaemon(io, home);
  if (!d) {
    io.err("mitori: no daemon is running\n");
    return 0;
  }
  if (!(await stopDaemon(io, d, "cli", home))) {
    io.err(`mitori: the daemon (pid ${d.registry.pid}) did not stop in time\n`);
    return 1;
  }
  io.err(`mitori: stopped (pid ${d.registry.pid})\n`);
  return 0;
}
