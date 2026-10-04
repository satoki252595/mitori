// Where a warm (unchanged) rescan spends its time: `bun bench/runners/idx-warm-probe.ts --repo <dir> [--shadow] [--n 5]`.
// Prints, per rescan, the wall time and ScanTimings of an S0–S1 rescan and of a full S0–S4 rescan (diagnostics for the
// idx.warm.rescan* cases; not a bench case itself).
import { parseArgs } from "node:util";
import { scratch } from "../lib/child.ts";
import { benchIndexer, settled } from "../lib/indexer.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { repo: { type: "string" }, shadow: { type: "boolean" }, n: { type: "string" } } });
if (!values.repo) throw new Error("--repo is required");
const home = scratch("warm-probe");
const b = await benchIndexer({ root: values.repo, home: home.dir, shadow: values.shadow ?? false });
try {
  await b.idx.scan({ reason: "bench" });
  await settled(b.idx);
  const n = Number(values.n ?? 5);
  for (const until of ["S1", undefined] as const) {
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await b.idx.scan({ reason: "bench", ...(until ? { until } : {}) });
      const ms = performance.now() - t0;
      const t = b.idx.lastTimings();
      console.log(
        JSON.stringify({ until: until ?? "S4", ms: Math.round(ms * 10) / 10, s0: t?.s0, s1: t?.s1, s2: t?.s2, s3: t?.s3, s4: t?.s4, parsed: t?.filesParsed }),
      );
    }
    await settled(b.idx);
  }
} finally {
  await b.close();
  home.dispose();
}
