// Offline evidence only: source existence and ranges do not establish that a sentence is true.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const evidence = resolve(process.argv[2] ?? "docs/progress/oss-quality-2026-10-05");
const { samples } = JSON.parse(readFileSync(join(evidence, "selection.json"), "utf8")) as {
  samples: { repo: string; root: string; sha: string }[];
};
const results = [];
for (const sample of samples) {
  const name = sample.repo.split("/").at(-1) as string;
  const prefix = name === "m3e-canvas" ? "m3e-" : name === "jev-ultrafast" ? "jev-" : "laya-";
  const runs = readdirSync(evidence)
    .filter((d) => (d === name || d.startsWith(prefix)) && existsSync(join(evidence, d, "report.json")))
    .map((d) => ({ dir: d, report: JSON.parse(readFileSync(join(evidence, d, "report.json"), "utf8")) }))
    .filter((r) => r.report.run)
    .sort((a, b) => Date.parse(a.report.run.startedAt) - Date.parse(b.report.run.startedAt));
  const latest = runs.at(-1);
  if (!latest) continue;
  const dir = join(evidence, latest.dir);
  const report = latest.report;
  // A fresh Pass 1 may use another clean clone; never borrow coverage from an older sample's doc index.
  const generatedRoot = resolve(report.repo);
  const cacheRoot = resolve(sample.root, "..");
  if (relative(cacheRoot, realpathSync(generatedRoot)).startsWith("..")) throw new Error(`${name}: generated clone is outside the sample cache`);
  for (const sourceRoot of [sample.root, generatedRoot]) {
    const head = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", sourceRoot, "rev-parse", "HEAD"]);
    if (head.exitCode !== 0 || head.stdout.toString().trim() !== sample.sha) throw new Error(`${name}: pinned source SHA changed`);
  }
  const files: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const p = join(path, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith(".md")) files.push(p);
    }
  };
  walk(join(dir, "doc"));
  const invalidCites: string[] = [];
  const text = files.map((p) => readFileSync(p, "utf8")).join("\n");
  let cites = 0;
  for (const match of text.matchAll(/\]\(([^)]+)#L(\d+)(?:-L(\d+))?\)/g)) {
    cites++;
    const path = decodeURIComponent((match[1] as string).replace(/^(?:\.\.\/)+/, ""));
    const source = resolve(sample.root, path);
    const rel = relative(sample.root, source);
    const first = Number(match[2]);
    const last = Number(match[3] ?? match[2]);
    if (
      rel.startsWith("..") ||
      !existsSync(source) ||
      relative(sample.root, realpathSync(source)).startsWith("..") ||
      !statSync(source).isFile() ||
      first < 1 ||
      last < first ||
      last > readFileSync(source, "utf8").split("\n").length
    )
      invalidCites.push(`${path}:${first}-${last}`);
  }
  const questions = readFileSync(join(dir, "doc", "13-open-questions.md"), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("- **"))
    .map((l) => l.replace(/ <!--.*$/, ""));
  const index = JSON.parse(readFileSync(join(generatedRoot, ".mitori", "doc.index.json"), "utf8")) as {
    sections: Record<string, { id: string; state: string }>;
    blocks: Record<string, { section: string; origin: string; aspect: string }>;
  };
  const moduleCoverage = Object.values(index.sections)
    .filter((s) => s.id.startsWith("s6/"))
    .map((s) => ({
      section: s.id,
      state: s.state,
      aspects: [
        ...new Set(
          Object.values(index.blocks)
            .filter((b) => b.section === s.id && b.origin === "ai")
            .map((b) => b.aspect),
        ),
      ].sort(),
    }));
  results.push({
    repo: sample.repo,
    sourceSha: sample.sha,
    latestSnapshot: latest.dir,
    run: report.run.state,
    progress: report.run.progress,
    runHistory: runs.map((r) => ({ snapshot: r.dir, state: r.report.run.state, progress: r.report.run.progress, apiEquivalentUsd: r.report.spentUsd })),
    apiEquivalentUsd: runs.reduce((sum, r) => sum + r.report.spentUsd, 0),
    generationMs: report.runMs,
    nativeChildren: report.childProcesses,
    moduleCoverage,
    docFiles: files.length,
    sourceLinks: cites,
    invalidCites,
    inferredLabels: [...text.matchAll(/（推測）/g)].length,
    awkwardTermCounts: Object.fromEntries(["卓上版", "携帯面", "HTTP 誤差", "保存書類", "業者"].map((s) => [s, text.split(s).length - 1])),
    questions,
    duplicateQuestions: questions.length - new Set(questions.map((q) => q.replace(/^- \*\*[^*]+\*\*：/, ""))).size,
  });
}
writeFileSync(join(evidence, "quality.audit.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
for (const r of results) console.log(`${r.repo}: ${r.sourceLinks} source links, ${r.invalidCites.length} invalid, ${r.questions.length} questions`);
if (
  results.length !== samples.length ||
  results.some((r) => r.run !== "done" || r.progress.failed !== 0 || r.invalidCites.length !== 0 || r.moduleCoverage.some((s) => s.state !== "generated"))
)
  process.exitCode = 1;
