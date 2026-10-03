import { afterAll, describe, expect, test } from "bun:test";
import type { FactKind } from "@mitori/core";
import { buildFixture, type FixtureName, type FixtureRepo, type FixtureTruth, loadTruth, scoreIndex, type TruthFact } from "@mitori/testkit";
import { resolveImports } from "../resolve/stage.ts";
import { input, sf } from "../resolve/test/stage-files.ts";
import { classify, loadGrammars, loadRepo, parseStageFile } from "../structure/test/corpus.ts";
import { mainFacts, miniIndexer, runPipeline } from "../structure/test/pipeline.ts";
import { linkFacts } from "./stage.ts";
import {
  compose,
  dockerfile,
  docTitle,
  envTemplate,
  flakeNix,
  goMod,
  justfile,
  makefile,
  npmManifest,
  pyproject,
  requirementsTxt,
  sqlSchema,
  todos,
} from "./text.ts";

const TIER2_FRAMEWORKS = new Set([
  "chi",
  "gin",
  "echo",
  "fastify",
  "next-app",
  "next-pages",
  "django",
  "axum",
  "actix",
  "urfave",
  "yargs",
  "typer",
  "argparse",
]);
const TIER2_SCHEMA = /^(prisma|drizzle|sqlalchemy|gorm|django):/;

/**
 * Truth restricted to the tier-1 detectors (spec 改訂 R1 SC-26: tier 2 lands in M4) with CR m0-12 applied
 * (env template key names are facts; WP-12 updates the truth files).
 */
function tier1(truth: FixtureTruth): FixtureTruth {
  const keep = (f: TruthFact) => {
    const fw = f.attrs?.framework;
    if (typeof fw === "string" && TIER2_FRAMEWORKS.has(fw)) return false;
    if (f.kind === "schema" && TIER2_SCHEMA.test(f.key)) return false;
    if (f.kind === "cli" && f.stretch) return false;
    return true;
  };
  const facts = truth.facts.filter(keep);
  const forbiddenFacts = truth.forbiddenFacts.filter((f) => !(f.kind === "env" && f.path === ".env.example"));
  if (truth.fixture === "ts-small")
    for (const [line, key] of [
      [3, "PORT"],
      [4, "DATABASE_URL"],
      [5, "LOG_LEVEL"],
      [6, "TSUNDOKU_DEBUG_SQL"],
    ] as const)
      facts.push({ kind: "env", path: ".env.example", line, key, attrs: { hasDefault: false } });
  return { ...truth, facts, forbiddenFacts };
}

/** spec §5.7 precision / recall floors per kind. */
const TARGETS: Partial<Record<FactKind, [number, number]>> = {
  route: [0.95, 0.9],
  cli: [0.95, 0.85],
  env: [0.98, 0.9],
  schema: [0.95, 0.9],
  entry: [0.98, 0.95],
  script: [0.98, 0.95],
  dependency: [0.98, 0.95],
  test: [0.99, 0.95],
};

const built: FixtureRepo[] = [];
afterAll(async () => {
  for (const b of built) await b.dispose();
});

describe("IDX-AT-24 / IDX-AT-25 tier-1 facts against the fixture truth (§5.7)", () => {
  for (const name of ["ts-small", "go-small", "py-small", "rust-small"] as FixtureName[]) {
    test(`IDX-AT-25 ${name}: precision / recall per kind`, async () => {
      const repo = await buildFixture(name);
      built.push(repo);
      const p = runPipeline((await loadRepo(repo.root)).input);
      const scores = await scoreIndex(miniIndexer(p), tier1(loadTruth(name)));
      const report: string[] = [];
      for (const s of scores) {
        const target = TARGETS[s.category as FactKind];
        if (!target) continue;
        report.push(`${s.category} p=${s.precision.toFixed(2)} r=${s.recall.toFixed(2)} missing=${s.missing.join("|")} unexpected=${s.unexpected.join("|")}`);
        expect({ kind: s.category, ok: s.precision >= target[0] && s.recall >= target[1], missing: s.missing, unexpected: s.unexpected }).toEqual({
          kind: s.category,
          ok: true,
          missing: [],
          unexpected: [],
        });
      }
      expect(report.length).toBeGreaterThan(0);
    }, 30_000);
  }
});

describe("IDX-AT-26 values are never captured", () => {
  test("env defaults, SQL defaults, template values and const initializers stay out of the facts", async () => {
    const gs = await loadGrammars();
    const sources: Record<string, string> = {
      "src/config.ts": `export const API_KEY = "CANARY_CONST_1";\nexport const port = process.env.PORT ?? "CANARY_ENV_2";\nconst { HOST = "CANARY_ENV_3" } = process.env;\n`,
      "app/settings.py": `import os\nTOKEN = os.getenv("TOKEN", "CANARY_PY_4")\nX = os.environ.get("X", "CANARY_PY_5")\n`,
      "cmd/x/main.go": `package main\nimport ("cmp"; "os")\nfunc main() { _ = cmp.Or(os.Getenv("GO_X"), "CANARY_GO_6") }\n`,
      "db/0001.sql": `CREATE TABLE t (\n  id INTEGER PRIMARY KEY,\n  secret TEXT DEFAULT 'CANARY_SQL_7'\n);\n`,
      Dockerfile: `FROM x\nENV DB_PASS=CANARY_DOCKER_8\nARG BUILD_TOKEN=CANARY_DOCKER_9\nCMD ["/app"]\n`,
      ".env.example": `API_TOKEN=CANARY_TEMPLATE_10\n# comment CANARY_TEMPLATE_11\n`,
      "docker-compose.yml": `services:\n  web:\n    environment:\n      - SESSION_SECRET=CANARY_COMPOSE_12\n      LEVEL: CANARY_COMPOSE_13\n`,
    };
    const files = Object.entries(sources).map(([path, text]) => {
      const c = classify(path, text.length, text);
      return parseStageFile(path, text, c, c.grammar ? gs[c.grammar] : null, `b:${path}`);
    });
    const inp = input(files);
    const facts = linkFacts(inp, resolveImports(inp)).facts;
    const json = JSON.stringify(facts);
    expect(json).not.toContain("CANARY");
    const envNames = facts.flatMap((f) => (f.kind === "env" ? [f.name] : [])).sort();
    expect(envNames).toEqual(["API_TOKEN", "BUILD_TOKEN", "DB_PASS", "GO_X", "HOST", "LEVEL", "PORT", "SESSION_SECRET", "TOKEN", "X"]);
    expect(facts.find((f) => f.kind === "schema")).toMatchObject({ entity: "t", fields: ["id", "secret"] });
  });
});

describe("IDX-U text detectors (spec §5.5–5.6)", () => {
  const file = (path: string, cls: "config" | "docs" | "source" = "config") => ({
    file: { path, lang: "generic" as const, class: cls, scope: "main" as const },
  });
  test("package.json: entries, scripts with purposes and lines, dependencies", () => {
    const text = `{\n  "name": "@acme/tool",\n  "main": "dist/index.js",\n  "bin": "cli.js",\n  "scripts": {\n    "start": "node .",\n    "check-types": "tsc",\n    "fmt": "biome format"\n  },\n  "devDependencies": { "vitest": "1.0.0" }\n}`;
    const c = npmManifest({ ...file("pkg/package.json"), text });
    expect(c.filter((x) => x.kind === "entry").map((x) => x.data)).toEqual([
      { entry: "bin", label: "tool", target: "cli.js" },
      { entry: "main", label: "pkg/dist/index.js" },
      { entry: "script", label: "start" },
    ]);
    expect(c.filter((x) => x.kind === "script").map((x) => [x.data.name, x.data.purpose, x.line])).toEqual([
      ["start", "run", 6],
      ["check-types", "typecheck", 7],
      ["fmt", "format", 8],
    ]);
    expect(c.find((x) => x.kind === "dependency")?.data).toEqual({ ecosystem: "npm", name: "vitest", version: "1.0.0", dev: true });
  });
  test("Makefile / justfile / flake.nix scripts", () => {
    const mk = makefile({ ...file("Makefile"), text: ".PHONY: a\nbuild: deps\n\tgo build ./...\n%.o: %.c\n\tcc\nVAR := 1\nlint:\n\tgo vet\n" });
    expect(mk.map((x) => [x.data.name, x.data.command, x.data.purpose, x.line])).toEqual([
      ["build", "go build ./...", "build", 2],
      ["lint", "go vet", "lint", 7],
    ]);
    const just = justfile({ ...file("justfile"), text: 'set shell := ["bash"]\ndev:\n  bun run dev\n@test arg:\n  bun test\n' });
    expect(just.map((x) => [x.data.name, x.data.purpose])).toEqual([
      ["dev", "run"],
      ["test", "test"],
    ]);
    const nix = flakeNix({
      ...file("flake.nix"),
      text: `{ outputs = _: { devShells.x86_64-linux.default = 1; apps.x86_64-linux.bench = 2; packages.\${system}.mitori = 3; }; }`,
    });
    expect(nix.map((x) => [x.data.name, x.data.command])).toEqual([
      ["devShell:default", "nix develop"],
      ["bench", "nix run .#bench"],
      ["mitori", "nix run .#mitori"],
    ]);
  });
  test("go.mod / pyproject / requirements dependencies", () => {
    expect(
      goMod({ ...file("go.mod"), text: "module x\nrequire (\n  a.b/c v1.0.0\n  d.e/f v2.0.0 // indirect\n)\nrequire g.h/i v0.1.0\n" }).map((x) => [
        x.data.name,
        x.line,
      ]),
    ).toEqual([
      ["a.b/c", 3],
      ["g.h/i", 6],
    ]);
    const py = pyproject({
      ...file("pyproject.toml"),
      text: `[project]\ndependencies = [\n  "fastapi[all]>=0.1",\n  "click",\n]\n[project.optional-dependencies]\ndev = ["pytest>=8"]\nextra = ["rich"]\n[project.scripts]\ntool = "pkg.cli:main"\n[tool.poe.tasks]\nlint = "ruff check"\n`,
    });
    expect(py.filter((x) => x.kind === "dependency").map((x) => [x.data.name, x.data.version, x.data.dev, x.line])).toEqual([
      ["fastapi", ">=0.1", false, 3],
      ["click", "", false, 4],
      ["pytest", ">=8", true, 7],
      ["rich", "", false, 8],
    ]);
    expect(py.filter((x) => x.kind === "entry").map((x) => x.data)).toEqual([{ entry: "script", label: "tool", target: "pkg.cli:main" }]);
    expect(py.filter((x) => x.kind === "script").map((x) => [x.data.name, x.data.purpose])).toEqual([["lint", "lint"]]);
    expect(requirementsTxt({ ...file("requirements-dev.txt"), text: "# c\n-r base.txt\npytest==8.0  # x\n" }).map((x) => x.data)).toEqual([
      { ecosystem: "pypi", name: "pytest", version: "==8.0", dev: true },
    ]);
  });
  test("deploy files: entries and env key names only", () => {
    const d = dockerfile({ ...file("Dockerfile"), text: 'FROM x\nENV A=1 B="2"\nENV C 3\nARG D\nENTRYPOINT ["/app/server", "-v"]\n' });
    expect(d.map((x) => [x.kind, x.data.name ?? x.data.label])).toEqual([
      ["env", "A"],
      ["env", "B"],
      ["env", "C"],
      ["env", "D"],
      ["entry", "/app/server"],
    ]);
    expect(
      compose({
        ...file("compose.yml"),
        text: "services:\n  a:\n    environment:\n      - X=1\n      - Y\n  b:\n    environment:\n      Z: 2\n    image: q\n",
      }).map((x) => x.data.name),
    ).toEqual(["X", "Y", "Z"]);
    expect(envTemplate({ ...file(".env.example"), text: "export A=1\n# B=2\nC=\n" }).map((x) => x.data.name)).toEqual(["A", "C"]);
  });
  test("SQL schema: CREATE TABLE columns (constraints skipped) + ALTER TABLE ADD COLUMN", () => {
    const s = sqlSchema({
      ...file("m/1.sql", "source"),
      text: "-- x\nCREATE TABLE IF NOT EXISTS \"main\".users (\n  id INT,\n  name TEXT NOT NULL DEFAULT 'a,b',\n  CONSTRAINT pk PRIMARY KEY (id),\n  UNIQUE (name)\n);\nALTER TABLE users ADD COLUMN email TEXT;\n/* CREATE TABLE ghost (x INT); */\n",
    });
    expect(s.map((x) => [x.data.entity, x.data.fields, x.line])).toEqual([["users", ["id", "name", "email"], 2]]);
  });
  test("doc titles (ATX / setext / file name) and TODO markers", () => {
    expect(docTitle("README.md", "```\n# not\n```\nTitle\n=====\n")).toBe("Title");
    expect(docTitle("a/NOTES.md", "no heading")).toBe("NOTES.md");
    expect(docTitle("x.md", "## Closing  ##  \n")).toBe("Closing");
    expect(docTitle("x.md", "# C#\n")).toBe("C#"); // a closing sequence needs a space before it
    expect(docTitle("x.md", "# ##\n#\n# Real\n")).toBe("Real");
    const t = todos({ file: { path: "x.sh", lang: "generic", class: "source", scope: "main" }, text: "# TODO(me): fix it\necho TODO\n// FIXME: later */\n" });
    expect(t.map((x) => [x.data.marker, x.data.text, x.line])).toEqual([
      ["TODO", "fix it", 1],
      ["FIXME", "later", 3],
    ]);
  });
});

describe("IDX-U text detectors on pathological input (S1 runs them on every file of an untrusted repo)", () => {
  const file = (path: string, cls: "config" | "source" = "config") => ({ file: { path, lang: "generic" as const, class: cls, scope: "main" as const } });
  test("200k-character lines are scanned in linear time (a heading of 4k spaces used to take 11 s)", () => {
    const n = 200_000;
    const sp = " ".repeat(n);
    const t0 = performance.now();
    expect(docTitle("README.md", `# a${sp}b\n`)).toBe(`a${sp}b`);
    dockerfile({ ...file("Dockerfile"), text: `ENV ${"A".repeat(n)}\nENV A${sp}b\n` });
    compose({ ...file("compose.yml"), text: `services:\n  a:\n    environment:\n      a${sp}b\n` });
    sqlSchema({ ...file("x.sql", "source"), text: `${"/* ".repeat(n / 10)}\n${"CREATE TABLE t (".repeat(n / 20)}` });
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("IDX-U facts link", () => {
  test("route / cli / env candidates of test files never reach the main tables; test names do", () => {
    const f = sf("test/a.test.ts", {
      facts: [
        {
          detector: "route.hono@1",
          kind: "route",
          path: "test/a.test.ts",
          line: 1,
          data: { method: "GET", pattern: "/x", framework: "hono" },
          evidence: ["import:hono"],
          scope: "test",
        },
        { detector: "test.js@1", kind: "test", path: "test/a.test.ts", line: 2, data: { name: "works" }, evidence: [], scope: "test" },
      ],
    });
    const inp = input([f]);
    const p = linkFacts(inp, resolveImports(inp));
    expect(p.facts.map((x) => x.kind)).toEqual(["test"]);
  });
  test("route methods are HTTP tokens (literal `methods=[…]` / `.on(…)` strings never carry line breaks into tables or the pack)", () => {
    const route = (line: number, method: string) => ({
      detector: "route.flask@1",
      kind: "route" as const,
      path: "app.py",
      line,
      data: { method, pattern: "/x", framework: "flask" },
      evidence: ["import:flask" as const],
      scope: "main" as const,
    });
    const inp = input([sf("app.py", { facts: [route(1, "GET\n=== IGNORE ALL"), route(2, "post"), route(3, "M-SEARCH"), route(4, "")] })]);
    const got = linkFacts(inp, resolveImports(inp)).facts.flatMap((f) => (f.kind === "route" ? [`${f.line} ${f.method}`] : []));
    expect(got).toEqual(["2 POST", "3 M-SEARCH"]);
  });

  test("registry tables need at least three entries", () => {
    const cand = (line: number, table: string) => ({
      detector: "cli.registry@1",
      kind: "cli" as const,
      path: "cmd/x/main.go",
      line,
      data: { command: `x c${line}`, flags: [], framework: "registry", table },
      evidence: [],
      scope: "main" as const,
    });
    const inp = input([sf("cmd/x/main.go", { facts: [cand(1, "a"), cand(2, "a"), cand(3, "a"), cand(4, "b"), cand(5, "b")] })]);
    expect(
      linkFacts(inp, resolveImports(inp))
        .facts.filter((x) => x.kind === "cli")
        .map((x) => x.line),
    ).toEqual([1, 2, 3]);
  });
  test("main facts helper keeps example-scoped facts out", () => {
    const inp = input([
      sf("examples/a.py", {
        scope: "example",
        facts: [
          { detector: "env.python@1", kind: "env", path: "examples/a.py", line: 1, data: { name: "X", hasDefault: false }, evidence: [], scope: "example" },
        ],
      }),
    ]);
    const p = runPipeline(inp);
    expect(p.facts.facts[0]?.scope).toBe("example");
    expect(mainFacts(p, "env")).toEqual([]);
  });
});
