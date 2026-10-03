/**
 * `mitori` entry (owner: WP-11a). M0 hello: only `--version`. Keep the top level import-free so the compiled
 * binary starts in ≤ 20 ms; load commands lazily (`await import(...)`) when they exist.
 */
import pkg from "../package.json" with { type: "json" };

const API_VERSION = 1;

export function versionLine(): string {
  return `mitori ${pkg.version} (api ${API_VERSION})`;
}

function main(argv: readonly string[]): number {
  const [cmd] = argv;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`${versionLine()}\n`);
    return 0;
  }
  process.stderr.write(`${versionLine()}\nusage: mitori --version   (commands arrive with WP-11a / WP-11)\n`);
  return cmd === undefined || cmd === "--help" || cmd === "-h" ? 0 : 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
