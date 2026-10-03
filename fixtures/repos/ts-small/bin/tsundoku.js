#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { exportBooks, importCsv } from "../src/services/importer.ts";

const program = new Command().name("tsundoku").description("Manage the pile of books you have not read yet");

program
  .command("import")
  .description("import books from a CSV file (isbn,title,status)")
  .argument("<file>", "CSV file")
  .option("--dry-run", "validate the file without storing anything")
  .action((file, opts) => {
    const result = importCsv(readFileSync(file, "utf8"), { dryRun: Boolean(opts.dryRun) });
    console.log(`${opts.dryRun ? "would import" : "imported"} ${result.imported}, skipped ${result.skipped}`);
    for (const error of result.errors) console.error(error);
    process.exitCode = result.errors.length > 0 ? 1 : 0;
  });

program
  .command("export")
  .description("print the pile")
  .option("--format <format>", "output format", "json")
  .action((opts) => {
    console.log(exportBooks(opts.format));
  });

program
  .command("serve")
  .description("start the HTTP service")
  .option("-p, --port <port>", "port to listen on", "8787")
  .action((opts) => {
    spawnSync("bun", ["run", "dev", "--port", String(opts.port)], { stdio: "inherit" });
  });

program.parse();
