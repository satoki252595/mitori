// Only allowlisted protocol metadata is exported; private recordings/env/prompt bytes remain ignored.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve("node_modules/.cache/mitori-oss-quality-20261005");
const evidence = "docs/progress/oss-quality-2026-10-05";
const result = [];
for (const name of readdirSync(evidence).sort()) {
  const reportFile = join(evidence, name, "report.json");
  if (!existsSync(reportFile)) continue;
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (!report.run || report.aggregate.total.engineTasks === 0) continue;
  const raw = join(root, `${name}-raw`);
  if (!existsSync(raw)) throw new Error(`${name}: private native recordings are missing; no protocol audit can be claimed`);
  const calls = [];
  for (const file of readdirSync(raw)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()) {
    const record = JSON.parse(readFileSync(join(raw, file), "utf8")) as { argv: string[]; out: [number, string][]; exit: number };
    const kinds: Record<string, number> = {};
    const models = new Set<string>();
    const terminal: string[] = [];
    for (const [, line] of record.out) {
      const event = JSON.parse(line) as { payload: { kind: string; model_id?: string; terminal?: string } };
      const p = event.payload;
      kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      if (p.kind === "run_model_configured" && p.model_id) models.add(p.model_id);
      if (p.kind === "run_terminal" && p.terminal) terminal.push(p.terminal);
    }
    const requiredFlags = ["--disable-shell", "--disable-write", "--disable-web-tools", "--no-foreign-personal-context", "--no-session-log"];
    const value = (flag: string) => record.argv[record.argv.indexOf(flag) + 1];
    const profileSafe =
      models.size === 1 &&
      models.has("muse-spark-1.3-contributor") &&
      requiredFlags.every((flag) => record.argv.includes(flag)) &&
      value("--reasoning-effort") === "max" &&
      value("--worktree") === "off" &&
      value("--max-model-steps") === "1" &&
      !Object.keys(kinds).some((kind) => /tool|shell|exec|write/i.test(kind));
    const completed = record.exit === 0 && terminal.includes("completed");
    calls.push({
      recording: file,
      models: [...models],
      terminal,
      requiredFlags,
      requestedEffort: value("--reasoning-effort"),
      kinds,
      exit: record.exit,
      profileSafe,
      completed,
    });
  }
  if (calls.length === 0) throw new Error(`${name}: engine tasks have no native recordings`);
  result.push({ sample: name, calls });
}
writeFileSync("docs/progress/oss-quality-2026-10-05/native.audit.json", `${JSON.stringify(result, null, 2)}\n`);
for (const sample of result)
  console.log(
    `${sample.sample}: ${sample.calls.length} native calls, ${sample.calls.filter((c) => !c.profileSafe).length} unsafe profiles, ${sample.calls.filter((c) => !c.completed).length} incomplete calls`,
  );
// A cancelled sample keeps its incomplete call in the evidence; completion is checked by oss-quality.ts.
if (result.length === 0 || result.some((sample) => sample.calls.some((c) => !c.profileSafe))) process.exitCode = 1;
