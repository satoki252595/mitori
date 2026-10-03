/**
 * `mitori` entry (owner: WP-11a). Keep the top level import-free so the compiled binary starts in ≤ 20 ms
 * (`bin.startup`); every command is loaded lazily. The compiled binary enters through the generated
 * `dist/.build/entry.ts` (scripts/gen-assets.ts), which registers the embedded assets and then calls {@link main}.
 */
import pkg from "../package.json" with { type: "json" };

const API_VERSION = 1;

const USAGE = `usage: mitori [<path>] [--no-open]    open a repository (walking skeleton: foreground daemon, prints the URL)
       mitori --version
       mitori _serve [--port <n>]       daemon only
       mitori _selftest [--json]        check the embedded assets, Workers and runtime
`;

export function versionLine(): string {
  return `mitori ${pkg.version} (api ${API_VERSION})`;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [cmd = ""] = argv;
  switch (cmd) {
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`${versionLine()}\n`);
      return 0;
    case "--help":
    case "-h":
    case "help":
      process.stderr.write(`${versionLine()}\n${USAGE}`);
      return 0;
    case "_serve":
      return (await import("./daemon/run.ts")).runDaemon("serve", argv.slice(1), pkg.version);
    case "_selftest":
      return (await import("./build/selftest.ts")).selftest(argv.slice(1), pkg.version);
  }
  if (cmd === "" || !cmd.startsWith("-") || cmd === "--no-open" || cmd === "--force")
    return (await import("./daemon/run.ts")).runDaemon("open", argv, pkg.version);
  process.stderr.write(`mitori: unknown option ${cmd}\n${USAGE}`);
  return 2;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
