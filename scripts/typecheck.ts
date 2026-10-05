// One checked solution build shares TypeScript's declaration/source and resolution caches across project references.
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { ROOT } from "./lib/repo.ts";

export function typecheck(root = ROOT, log: (text: string) => void = console.log): number {
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
  const started = performance.now();
  let errors = 0;
  let built = 0;
  const host = ts.createSolutionBuilderHost(ts.sys, undefined, (diagnostic) => {
    if (diagnostic.category === ts.DiagnosticCategory.Error) errors++;
    log(
      ts
        .formatDiagnostics([diagnostic], {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => root,
          getNewLine: () => "\n",
        })
        .trim(),
    );
  });
  host.afterProgramEmitAndDiagnostics = () => built++;
  // noCheck-only build-info has checkPending=true; the canonical builder rechecks it before reusing diagnostics.
  const code = ts.createSolutionBuilder(host, [rootConfig], { noCheck: false, stopBuildOnErrors: false }).build();
  // Only a successful solution proves that projects without a new semantic build reused checked incremental state.
  log(
    `typecheck: ${projects.size} projects, ${built} semantic builds${code === ts.ExitStatus.Success ? `, ${projects.size - built} cached` : ""}, ${errors} error(s), ${((performance.now() - started) / 1000).toFixed(2)} s`,
  );
  return code === ts.ExitStatus.Success ? 0 : 1;
}

if (import.meta.main) process.exit(typecheck());
