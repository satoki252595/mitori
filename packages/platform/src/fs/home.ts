// `~/.mitori` resolution (testing spec §1: the ONLY place that reads MITORI_HOME / os.homedir()).
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { MitoriError } from "@mitori/core";

/** Options of {@link resolveHome}. */
export interface ResolveHomeOptions {
  /** Environment to read `MITORI_HOME` from (default `process.env`). */
  env?: Readonly<Record<string, string | undefined>>;
  /** Create the directory (0700) when missing (default true). */
  create?: boolean;
}

/**
 * `MITORI_HOME` when set (must be absolute), else `<os home>/.mitori`. Created 0700 when missing; returns the
 * realpath when it exists (so it can be a SafeWriter `home` root).
 */
export function resolveHome(opts: ResolveHomeOptions = {}): string {
  const env = opts.env ?? process.env;
  const fromEnv = env.MITORI_HOME;
  const dir = fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".mitori");
  if (!isAbsolute(dir)) throw new MitoriError("E_CFG_INVALID", "MITORI_HOME must be an absolute path", { params: { key: "MITORI_HOME" } });
  if (opts.create ?? true) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}
