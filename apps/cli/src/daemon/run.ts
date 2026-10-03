/**
 * `mitori [<path>] [--no-open]` and `mitori _serve` for the walking skeleton (M0.5). The daemon runs in the foreground
 * of this process and prints its URL; detaching (`_serve` spawned headless), `~/.mitori/daemon.json`, the health
 * proof and opening the browser need the platform Spawner/SafeWriter/Random ports and arrive with WP-01 + WP-11.
 */
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { BUILD_FLAVOUR } from "../build/flavour.ts";
import { inventoryStub } from "./s0.ts";
import { startDaemon } from "./serve.ts";

const fail = (msg: string): number => {
  process.stderr.write(`mitori: ${msg}\n`);
  return 2;
};

export async function runDaemon(mode: "open" | "serve", argv: readonly string[], version: string): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : String(err)} (see mitori --help)`);
  }
  const { values, positionals } = parsed;
  const port = Number(values.port ?? process.env.MITORI_PORT ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fail(`invalid port ${values.port ?? process.env.MITORI_PORT}`);

  let target: string | null = null;
  if (mode === "open") {
    const raw = positionals[0] ?? process.cwd();
    if (/^(https?:\/\/|github\.com\/)/.test(raw)) return fail("opening a GitHub URL arrives with WP-11");
    try {
      target = realpathSync(raw);
      if (!statSync(target).isDirectory()) throw new Error("not a directory");
    } catch {
      return fail(`${raw}: no such directory`);
    }
  } else if (positionals.length > 0) return fail("_serve takes no path");

  const home = process.env.MITORI_HOME ?? join(homedir(), ".mitori");
  let daemon: Awaited<ReturnType<typeof startDaemon>>;
  try {
    daemon = await startDaemon({ home, port, version, build: BUILD_FLAVOUR });
  } catch (err) {
    process.stderr.write(`mitori: the daemon did not start: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (target !== null) {
    const s0 = inventoryStub(target);
    process.stderr.write(`mitori: ${basename(target)}: ${s0.files}${s0.truncated ? "+" : ""} files (S0 stub, ${s0.ms.toFixed(1)} ms)\n`);
  }
  // stdout carries the URL only (testing spec RQ-CLI-1: scripts, CI and eval read it)
  process.stdout.write(`${daemon.url}\n`);
  if (mode === "open" && !values["no-open"]) process.stderr.write("mitori: opening the browser arrives with WP-11 — open the URL above\n");

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await daemon.stop();
  return 0;
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: { "no-open": { type: "boolean" }, force: { type: "boolean" }, port: { type: "string" } },
  });
}
