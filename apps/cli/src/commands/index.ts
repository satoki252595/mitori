/**
 * @mitori/cli — `commands/` (owner: WP-11): the client subcommands of ARCHITECTURE §2.2 R1. Each module is loaded
 * only when its command runs (the binary starts in ≤ 20 ms and `touch` must exit in ≤ 50 ms without a daemon).
 */
import { HELP, helpLang } from "./help.ts";
import { exitOf, type Io } from "./io.ts";

/** A command: run against an {@link Io}, return the exit code. */
export interface Command {
  run(io: Io): Promise<number>;
}

const COMMANDS: Readonly<Record<string, () => Promise<Command>>> = {
  review: () => import("./review.ts"),
  bundle: () => import("./bundle.ts"),
  reply: () => import("./reply.ts"),
  touch: () => import("./touch.ts"),
  open: () => import("./open.ts"),
  check: () => import("./check.ts"),
  digest: () => import("./digest.ts"),
  gen: () => import("./gen.ts"),
  install: () => import("./install.ts"),
  mcp: () => import("./mcp.ts"),
  config: () => import("./config.ts"),
  setup: () => import("./setup.ts"),
  export: () => import("./export.ts"),
  share: () => import("./share.ts"),
  init: () => import("./init.ts"),
  scan: () => import("./scan.ts"),
  usage: () => import("./usage.ts"),
  stop: () => import("./stop.ts"),
  doctor: () => import("./doctor.ts"),
  pr: () => import("./pr.ts"),
};

/** Subcommand names (everything else is a path for `mitori <path>`). */
export const COMMAND_NAMES: readonly string[] = Object.keys(COMMANDS);

export function isCommand(name: string | undefined): boolean {
  return name !== undefined && Object.hasOwn(COMMANDS, name);
}

/**
 * Run `name` with `io` (`io.argv` = the arguments after the name). `--help` / `-h` prints the localized help. Errors
 * that escape the command are printed as `error <CODE>: <message>` with exit 1 (usage 2).
 */
export async function runCommand(name: string, io: Io): Promise<number> {
  const load = COMMANDS[name];
  if (!load) {
    io.err(`error E_INVALID_INPUT: unknown command ${name}\n`);
    return 2;
  }
  if (io.argv.includes("--help") || io.argv.includes("-h")) {
    io.out(HELP[name]?.[helpLang(io.env)] ?? "");
    return 0;
  }
  try {
    return await (await load()).run(io);
  } catch (e) {
    const { code, text } = exitOf(e);
    io.err(text);
    return code;
  }
}
