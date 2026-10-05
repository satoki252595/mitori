// Emit project-reference declarations once, then check every project's source with bounded parallelism.
// Separate semantic build-info files keep --noEmit from disturbing the declaration build's incremental state.
import { mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { ROOT } from "./lib/repo.ts";

export async function typecheck(root = ROOT, log: (text: string) => void = console.log): Promise<number> {
  const projects = new Set<string>();
  const visit = (file: string) => {
    if (projects.has(file)) return;
    projects.add(file);
    const config = ts.readConfigFile(file, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    for (const ref of config.config.references ?? []) {
      const path = resolve(dirname(file), ref.path);
      visit(path.endsWith(".json") ? path : join(path, "tsconfig.json"));
    }
  };
  const rootConfig = join(root, "tsconfig.json");
  visit(rootConfig);
  // This repository's solution config has no source; all referenced configs (including transitive ones) are checked.
  projects.delete(rootConfig);
  const run = async (name: string, argv: string[]) => {
    const started = performance.now();
    const proc = Bun.spawn(argv, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) log(`${name}:\n${out}${err}`.trim());
    return { code, ms: performance.now() - started };
  };

  const emit = await run("declarations", ["tsc", "-b", "--noCheck", "--pretty", "false"]);
  log(`typecheck: declarations ${(emit.ms / 1000).toFixed(2)} s`);
  let failed = emit.code !== 0 ? 1 : 0;
  const pending = [...projects];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let file = pending.shift(); file; file = pending.shift()) {
        const info = join(root, "node_modules/.cache/tsc-semantic", relative(root, dirname(file)), "tsconfig.tsbuildinfo");
        mkdirSync(dirname(info), { recursive: true });
        const r = await run(relative(root, file), ["tsc", "-p", file, "--noEmit", "--noCheck", "false", "--pretty", "false", "--tsBuildInfoFile", info]);
        if (r.code !== 0) failed++;
      }
    }),
  );
  log(`typecheck: ${projects.size} semantic checks, 3 parallel, ${failed} failure(s), ${((performance.now() - started) / 1000).toFixed(2)} s`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await typecheck());
