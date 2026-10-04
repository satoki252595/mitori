// `bun scripts/under-load.ts [--procs <n>] [--warm <s>] -- <command…>`: run a command while <n> busy-looping processes
// (default: one per core) keep the machine loaded — the determinism check of the functional suite (a test that only
// passes on a quiet machine asserts a latency, and latency belongs in bench/, gated by the load check).
// Prints the 1-minute load average before the command, every 30 s while it runs, and at the end.
//   bun scripts/under-load.ts --procs 24 -- bun test
import { availableParallelism, loadavg } from "node:os";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  console.error("usage: bun scripts/under-load.ts [--procs <n>] [--warm <s>] -- <command…>");
  process.exit(2);
}
const opt = (k: string, d: number) => {
  const i = argv.indexOf(k);
  return i >= 0 && i < sep ? Number(argv[i + 1]) : d;
};
const procs = opt("--procs", availableParallelism());
const warm = opt("--warm", 20);
const command = argv.slice(sep + 1);
const la = () => (loadavg()[0] ?? 0).toFixed(1);

console.error(`under-load: loadavg ${la()} → starting ${procs} busy processes`);
const busy = Array.from({ length: procs }, () => Bun.spawn([process.execPath, "-e", "for (;;) {}"], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }));
const stopBusy = () => {
  for (const p of busy) p.kill("SIGKILL");
};
// the busy loops never outlive this script: an interrupt, a kill or a command that cannot start stops them too
for (const [sig, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const)
  process.on(sig, () => {
    stopBusy();
    process.exit(code);
  });
const samples: number[] = [];
let code = 1;
try {
  // the 1-minute average needs time to climb before the command starts
  await Bun.sleep(warm * 1000);
  console.error(`under-load: loadavg ${la()} → running: ${command.join(" ")}`);
  const iv = setInterval(() => {
    samples.push(loadavg()[0] ?? 0);
    console.error(`under-load: loadavg ${la()}`);
  }, 30_000);
  try {
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    code = await child.exited;
  } finally {
    clearInterval(iv);
  }
} finally {
  stopBusy();
}
const min = samples.length ? Math.min(...samples).toFixed(1) : la();
console.error(`under-load: exit ${code}; loadavg during the run: min ${min}, end ${la()} (samples every 30 s: ${samples.map((x) => x.toFixed(0)).join(" ")})`);
process.exit(code);
