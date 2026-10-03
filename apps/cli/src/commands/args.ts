/** Argument parsing shared by the commands: strict `node:util` parseArgs, usage errors exit 2. */
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import type { ThreadId } from "@mitori/core";
import { usage } from "./io.ts";

/** Parse `argv` strictly; unknown flags and missing values are usage errors (exit 2). */
export function parse<O extends ParseArgsOptionsConfig>(argv: readonly string[], options: O, cmd: string) {
  try {
    return parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (e) {
    throw usage(e instanceof Error ? e.message : String(e), `mitori ${cmd} --help`);
  }
}

/** A non-negative integer flag value within `[min, max]`, or a usage error. */
export function intFlag(raw: string | undefined, name: string, cmd: string, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw usage(`--${name} must be an integer in ${min}..${max}`, `mitori ${cmd} --help`);
  return n;
}

/** One of `values`, or a usage error. */
export function oneOf<T extends string>(raw: string | undefined, values: readonly T[], name: string, cmd: string): T | undefined {
  if (raw === undefined) return undefined;
  if (!(values as readonly string[]).includes(raw)) throw usage(`--${name} must be one of ${values.join("|")}`, `mitori ${cmd} --help`);
  return raw as T;
}

/** `th_` + 8 base32 chars (the MCP schema pattern). */
export const THREAD_RE = /^th_[0-9a-z]{8}$/;

export function threadArg(raw: string | undefined, cmd: string): ThreadId {
  if (raw === undefined) throw usage("a thread id is required", `mitori ${cmd} --help`);
  if (!THREAD_RE.test(raw)) throw usage(`not a thread id: ${raw}`, "thread ids look like th_k3f9a2cq");
  return raw as ThreadId;
}
