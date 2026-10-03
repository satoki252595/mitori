/**
 * `mitori pr <job>` (stretch, SEC-04): only opens the job's review page with the PR dialog — the PR itself is created
 * by a human click in the browser, never by a bearer request. Needs a TTY (agents are refused, exit 2).
 */
import { HREFS, type JobId } from "@mitori/core";
import { parse } from "./args.ts";
import { openInBrowser } from "./browser.ts";
import { type Io, usage } from "./io.ts";
import { connectWorkspace, requireTty } from "./session.ts";

export async function run(io: Io): Promise<number> {
  const { positionals } = parse(io.argv, {}, "pr");
  const job = positionals[0];
  if (job === undefined || !/^j_[0-9a-z]{10}$/.test(job) || positionals.length > 1) throw usage("usage: mitori pr <job_id>", "mitori pr --help");
  requireTty(io, "mitori pr");
  const s = await connectWorkspace(io);
  const path = `${HREFS.review(s.ws.info.key, job as JobId)}?pr=1`;
  io.out(`${s.daemon.origin}${path}\n`);
  await openInBrowser(io, s, null, path);
  return 0;
}
