/**
 * `mitori check <file> [--kind gen-output|repo-config|doc]` (loop spec §10.4): `POST /ws/:ws/check`, then ≤ 20 lines
 * `<at>: expected <x>, got <y> [<CODE>]`. Exit 0 valid, 1 errors, 2 usage. The kind follows from the path when it is
 * a prep output (`<docDir>/tmp/prep/<pr>/out/<task>.ndjson`) or the doc's `config.json`.
 * CR-PENDING(WP-11) cr-requests/WP-11.md #1: the validators live in gen, which the CLI may not import, so even this
 * pure check goes through the daemon (started when needed) instead of running in-process.
 */
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { CheckError, CheckReport } from "@mitori/core";
import { oneOf, parse } from "./args.ts";
import { type Io, usage } from "./io.ts";
import { PULL_EXIT } from "./loop-contract.ts";
import { connectWorkspace } from "./session.ts";
import { docDirOf, real, whenReady } from "./workspace.ts";

/** Max error lines printed. */
const MAX_LINES = 20;
/** A session-engine output file. */
export const PREP_OUT_RE = /\/tmp\/prep\/(pr_[0-9a-z]{8})\/out\/(gt_[0-9a-z]{10})\.ndjson$/;

/** `<at>: expected <x>, got <y> [<CODE>]` lines (≤ 20, then a count of the rest). */
export function errorLines(errors: readonly CheckError[]): string {
  const shown = errors.slice(0, MAX_LINES).map((e) => `${e.at}: expected ${e.expected}, got ${e.actual} [${e.code}]\n`);
  return shown.join("") + (errors.length > MAX_LINES ? `… ${errors.length - MAX_LINES} more\n` : "");
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(io.argv, { kind: { type: "string" } }, "check");
  const file = positionals[0];
  if (file === undefined || positionals.length > 1) throw usage("give exactly one file", "mitori check --help");
  let kind = oneOf(values.kind, ["gen-output", "repo-config", "doc"] as const, "kind", "check");
  const s = await connectWorkspace(io);
  const abs = real(resolve(io.cwd, file));
  const docDir = real(docDirOf(s.ws.info));
  if (kind === undefined) {
    if (PREP_OUT_RE.test(abs)) kind = "gen-output";
    else if (abs === `${docDir}/config.json`) kind = "repo-config";
    else if (abs.startsWith(`${docDir}/`) && abs.endsWith(".md")) kind = "doc";
    else throw usage(`cannot tell what ${file} is`, "pass --kind gen-output|repo-config|doc");
  }
  // gen outputs are named by their absolute path (the server resolves prep + task from it); the rest repo-relative
  const path = kind === "gen-output" ? abs : relative(realpathSync(s.ws.info.root), abs);
  const report: CheckReport = await whenReady(io, () => s.api.call("POST /ws/:ws/check", { params: { ws: s.ws.info.key }, body: { kind, path } }));
  if (report.ok) {
    io.out(`ok ${file}\n`);
    return PULL_EXIT.ok;
  }
  io.out(errorLines(report.errors));
  return PULL_EXIT.errors;
}
