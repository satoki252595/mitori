// Structural idle-resident samples after real generation. Reuses an authorized live run; spends no new tokens.
import { readFileSync } from "node:fs";
import { defineBench } from "./runner/define.ts";

interface LiveSample {
  run: { state: string };
  records: unknown[];
  residentSample: { engine: string; phase: string; scheduler: { procs: number; rssMb: number }; native: { procs: number; rssMb: number } };
}
function sample(): LiveSample {
  const path = process.env.MITORI_LIVE_BENCH_SAMPLE;
  if (!path) throw new Error("resident benchmarks require MITORI_LIVE_BENCH_SAMPLE=<gen-real report.json> from a completed real engine run");
  const report = JSON.parse(readFileSync(path, "utf8")) as LiveSample;
  if (report.run.state !== "done" || report.records.length === 0 || report.residentSample?.phase !== "idle-after-real-generation")
    throw new Error("resident sample is not from a completed real run");
  if (report.residentSample.scheduler.procs !== report.residentSample.native.procs)
    throw new Error("scheduler resident count differs from observed native children");
  return report;
}
export const residentProcs = defineBench({
  id: "agent.resident.procs",
  live: true,
  suite: "loop",
  mode: "inproc",
  unit: "count",
  runs: 1,
  warmup: 0,
  async run() {
    return sample().residentSample.native.procs;
  },
});
export const residentRss = defineBench({
  id: "agent.resident.rss",
  live: true,
  suite: "loop",
  mode: "inproc",
  unit: "MB",
  runs: 1,
  warmup: 0,
  async run() {
    return sample().residentSample.native.rssMb;
  },
});
