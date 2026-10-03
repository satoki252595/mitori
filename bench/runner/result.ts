// `mitori.bench-result/1` (testing spec §6.2): one file per run, also embedded in compare reports.
import { readFileSync, writeFileSync } from "node:fs";
import type { Samples } from "@mitori/testkit";
import { TEST_FORMATS } from "@mitori/testkit";
import type { BenchMode, BenchSuite } from "./define.ts";
import type { MachineInfo } from "./machine.ts";

export interface BenchResultEntry extends Samples {
  suite: BenchSuite;
  mode: BenchMode;
  repo?: string;
  /** Statistic compared with the budget. */
  budgetStat: "median" | "p95";
  /** The case threw; `values` is empty. */
  error?: string;
}

export interface BenchResultFile {
  v: typeof TEST_FORMATS.benchResult;
  /** HEAD of the measured tree ("" outside a repository). */
  sha: string;
  /** The base the compare gate measured against, when this file belongs to a head-vs-base report. */
  base?: string;
  machine: MachineInfo;
  /** runner / reference calibration time (§6.8); 1 with `factorSource: "assumed"` when it was not measured. */
  factor: number;
  factorSource: "measured" | "assumed";
  startedAt: string;
  results: BenchResultEntry[];
  counters: { id: string; value: number }[];
}

export function writeResult(path: string, file: BenchResultFile): void {
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

export function readResult(path: string): BenchResultFile {
  const doc = JSON.parse(readFileSync(path, "utf8")) as BenchResultFile;
  if (doc.v !== TEST_FORMATS.benchResult) throw new Error(`${path}: expected ${TEST_FORMATS.benchResult}, got ${String(doc.v)}`);
  return doc;
}
