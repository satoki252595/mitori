#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

await yargs(hideBin(process.argv))
  .scriptName("web-cli")
  .command(
    "sync",
    "synchronise the book list with the Go API",
    (y) => y.option("dry-run", { type: "boolean", describe: "print what would change" }),
    (argv) => {
      console.log(argv.dryRun ? "dry run: nothing written" : "synchronised");
    },
  )
  .demandCommand(1)
  .strict()
  .parseAsync();
