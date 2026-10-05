import { afterAll, describe, expect, test } from "bun:test";
import { createSecretScanner, type FactKind, REDACTION_TOKEN } from "@mitori/core";
import { buildFixture, type FixtureName, type FixtureRepo, type FixtureTruth, loadTruth, scoreIndex, type TruthFact } from "@mitori/testkit";
import { resolveImports } from "../resolve/stage.ts";
import { input, sf } from "../resolve/test/stage-files.ts";
import { classify, loadGrammars, loadRepo, parseStageFile } from "../structure/test/corpus.ts";
import { mainFacts, miniIndexer, runPipeline } from "../structure/test/pipeline.ts";
import { nextPattern } from "./next.ts";
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
  webEntries,
} from "./text.ts";

const TIER2_FRAMEWORKS = new Set([
  "chi",
  "gin",
  "echo",
  "fastify",
  // next-app / next-pages are graded: `route.next-app@1` / `route.next-pages@1` exist (gen #4a)
  "django",
  "axum",
  "actix",
  "urfave",
  "yargs",
  "typer",
  "argparse",
]);
const TIER2_SCHEMA = /^(prisma|drizzle|sqlalchemy|gorm|django):/;
const TOOLING = /^(scripts|tools|\.github)\//;

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
    // CR-PENDING(WP-03) B4: route / cli / env of tooling files (`scripts/` `tools/` `.github/`) stay out of the main
    // tables (indexer spec §2.2 scope, IDX-D12); the mixed truth lists two of them as main facts
    if ((f.kind === "route" || f.kind === "cli" || f.kind === "env") && TOOLING.test(f.path)) return false;
    return true;
  };
  const facts = truth.facts.filter(keep);
  // CR m0-12: a Rust bin root yields main:<path> + bin:<name>; the mixed truth has the main: row only
  if (truth.fixture === "mixed") facts.push({ kind: "entry", path: "tools/indexer-rs/src/main.rs", key: "bin:indexer-rs", stretch: true });
  const forbiddenFacts = truth.forbiddenFacts.filter((f) => !(f.kind === "env" && f.path === ".env.example"));
  if (truth.fixture === "ts-small")
    // WP-INT: WP-12 already moved TSUNDOKU_DEBUG_SQL into the truth (CR m0-12); do not add a second copy
    for (const [line, key] of [
      [3, "PORT"],
      [4, "DATABASE_URL"],
      [5, "LOG_LEVEL"],
      [6, "TSUNDOKU_DEBUG_SQL"],
    ] as const)
      if (!facts.some((f) => f.kind === "env" && f.path === ".env.example" && f.key === key))
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
  for (const name of ["ts-small", "go-small", "py-small", "rust-small", "mixed"] as FixtureName[]) {
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

describe("IDX-AT-25 env.js@1 reads", () => {
  test("short / lower-case names are located on the right node (`e` also occurs in `process`)", async () => {
    const gs = await loadGrammars();
    const text = `export const a = process.env.e;\nexport const b = import.meta.env.t ?? "x";\nexport const c = Bun.env.n;\nconst d = process.env["s"];\nDeno.env.get("g");\n// process.env.COMMENTED\n`;
    const c = classify("src/env.ts", text.length, text);
    const f = parseStageFile("src/env.ts", text, c, gs.typescript, "b0");
    const env = f.facts.filter((x) => x.kind === "env").map((x) => [x.data.name, x.line, x.data.hasDefault]);
    expect(env).toEqual([
      ["e", 1, false],
      ["t", 2, true],
      ["n", 3, false],
      ["s", 4, false],
      ["g", 5, false],
    ]);
  });
});

describe("gen #4c route handlers behind wrappers, factories and imports resolve", () => {
  const handlerOf = async (src: Record<string, string>) => {
    const gs = await loadGrammars();
    const files = Object.entries(src).map(([path, text]) => {
      const c = classify(path, text.length, text);
      return parseStageFile(path, text, c, c.grammar ? gs[c.grammar] : null, `b:${path}`);
    });
    const p = runPipeline(input(files));
    return Object.fromEntries(
      mainFacts(p, "route").map((r) => (r.kind === "route" ? [`${r.framework} ${r.method} ${r.pattern}`, r.handler ?? null] : ["", null])),
    );
  };

  test("net/http: middleware-wrapped method values, adapters and handler factories (crit's router)", async () => {
    const got = await handlerOf({
      "internal/server/server.go": [
        "package server",
        'import "net/http"',
        "type Server struct{ mux *http.ServeMux }",
        "func (s *Server) routes() {",
        "\tmux := http.NewServeMux()",
        '\tmux.HandleFunc("/api/health", s.handleHealth)',
        '\tmux.HandleFunc("/api/comments", s.withReady(s.handleComments))',
        '\tmux.HandleFunc("/api/file", s.withReady(s.withAuth(s.handleFile)))',
        '\tmux.Handle("/api/x", http.HandlerFunc(s.handleX))',
        '\tmux.HandleFunc("/live", s.serveIndexHTML())',
        '\tmux.HandleFunc("/live.js", s.serveEmbeddedJS("live.js"))',
        '\tmux.Handle("/", http.FileServer(http.Dir(".")))',
        '\tmux.HandleFunc("/inline", func(w http.ResponseWriter, r *http.Request) {})',
        "}",
        "func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request)   {}",
        "func (s *Server) handleComments(w http.ResponseWriter, r *http.Request) {}",
        "func (s *Server) handleX(w http.ResponseWriter, r *http.Request)        {}",
        "func (s *Server) withReady(h http.HandlerFunc) http.HandlerFunc        { return h }",
        "func (s *Server) withAuth(h http.HandlerFunc) http.HandlerFunc         { return h }",
        "func (s *Server) serveIndexHTML() http.HandlerFunc                      { return nil }",
        "func (s *Server) serveEmbeddedJS(name string) http.HandlerFunc         { return nil }",
        "",
      ].join("\n"),
      "internal/server/files.go": 'package server\n\nimport "net/http"\n\nfunc (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {}\n',
    });
    expect(got).toEqual({
      "net/http ANY /api/health": "internal/server/server.go#Server.handleHealth",
      "net/http ANY /api/comments": "internal/server/server.go#Server.handleComments",
      "net/http ANY /api/file": "internal/server/files.go#Server.handleFile",
      "net/http ANY /api/x": "internal/server/server.go#Server.handleX",
      "net/http ANY /live": "internal/server/server.go#Server.serveIndexHTML",
      "net/http ANY /live.js": "internal/server/server.go#Server.serveEmbeddedJS",
      "net/http ANY /": null,
      "net/http ANY /inline": null,
    });
  });

  test("hono / express: imported handlers, wrapped values, controller methods; flask / fastapi: call-registered views", async () => {
    const got = await handlerOf({
      "src/routes.ts": [
        'import { Hono } from "hono";',
        'import { listBooks, createBook } from "./handlers";',
        'import * as ctrl from "./ctrl";',
        "const app = new Hono();",
        'app.get("/books", listBooks);',
        'app.post("/books", auth(createBook));',
        'app.delete("/books/:id", ctrl.removeBook);',
        'app.get("/inline", (c) => c.text("ok"));',
        "function auth(h: unknown) { return h; }",
        "",
      ].join("\n"),
      "src/handlers.ts": "export function listBooks(c: unknown) { return c; }\nexport const createBook = async (c: unknown) => c;\n",
      "src/ctrl.ts": "export function removeBook(c: unknown) { return c; }\n",
      "app/views.py": [
        "from flask import Flask",
        "from flask.views import MethodView",
        "app = Flask(__name__)",
        "def index():",
        "    return 'ok'",
        "class Items(MethodView):",
        "    def get(self):",
        "        return 'items'",
        'app.add_url_rule("/", view_func=index)',
        'app.add_url_rule("/items", "items", Items.as_view("items"))',
        "",
      ].join("\n"),
      "app/api.py": [
        "from fastapi import FastAPI",
        "app = FastAPI()",
        "async def list_items():",
        "    return []",
        'app.add_api_route("/api/items", list_items)',
        "",
      ].join("\n"),
    });
    expect(got).toEqual({
      "hono GET /books": "src/handlers.ts#listBooks",
      "hono POST /books": "src/handlers.ts#createBook",
      "hono DELETE /books/:id": "src/ctrl.ts#removeBook",
      "hono GET /inline": null,
      "flask GET /": "app/views.py#index",
      "flask GET /items": "app/views.py#Items",
      "fastapi ANY /api/items": "app/api.py#list_items",
    });
  });
});

describe("gen #4a route.next-app@1 / route.next-pages@1: Next.js file-system routes", () => {
  test("nextPattern: groups and slots dropped, [id] kept, index = the directory, private folders and intercepting routes are none", () => {
    const pat = (p: string) => nextPattern(p)?.pattern ?? null;
    expect(pat("app/page.tsx")).toBe("/");
    expect(pat("src/app/(marketing)/about/page.tsx")).toBe("/about");
    expect(pat("app/blog/[slug]/@modal/page.tsx")).toBe("/blog/[slug]");
    expect(pat("app/api/books/[id]/route.ts")).toBe("/api/books/[id]");
    expect(pat("apps/web/app/settings/page.jsx")).toBe("/settings");
    expect(nextPattern("apps/web/app/settings/page.jsx")?.pkgDir).toBe("apps/web");
    expect(nextPattern("src/app/page.tsx")?.pkgDir).toBe("");
    expect(pat("app/_components/page.tsx")).toBeNull();
    expect(pat("app/photos/(.)[id]/page.tsx")).toBeNull();
    expect(pat("app/layout.tsx")).toBeNull();
    expect(pat("app/Editor.tsx")).toBeNull();
    expect(pat("pages/index.tsx")).toBe("/");
    expect(pat("src/pages/posts/[id].tsx")).toBe("/posts/[id]");
    expect(nextPattern("pages/api/books.ts")).toMatchObject({ pattern: "/api/books", api: true });
    expect(pat("pages/_app.tsx")).toBeNull();
    expect(pat("pages/page.test.tsx")).toBeNull();
  });

  test("routes with their handlers, only in a package that depends on next and at its root (m3e: GET / → Page)", async () => {
    const gs = await loadGrammars();
    const src: Record<string, string> = {
      "package.json": JSON.stringify({ name: "app", dependencies: { next: "16.3.4", react: "19.0.0" } }),
      "app/page.tsx":
        '"use client";\nimport Editor from "./Editor";\n// export default function Old() {}\nexport default function Page() {\n  return <Editor />;\n}\n',
      "app/Editor.tsx": "export default function Editor() {\n  return null;\n}\n",
      "app/api/items/route.ts":
        "export async function GET() {\n  return Response.json([]);\n}\n\nexport const POST = async (req: Request) => Response.json(await req.json());\nconst del = () => new Response(null);\nexport { del as DELETE };\n",
      "pages/api/legacy.ts": "export default function handler(req, res) {\n  res.json({});\n}\n",
      // a `pages/` folder below the package root is a component folder, not the pages router
      "src/components/pages/Home.tsx": "export default function Home() {\n  return null;\n}\n",
      // a server without next: its `app/` is no Next app
      "server/package.json": JSON.stringify({ name: "server", dependencies: { express: "4.0.0" } }),
      "server/app/page.ts": "export default function page() {}\n",
    };
    const files = Object.entries(src).map(([path, text]) => {
      const c = classify(path, text.length, text);
      return parseStageFile(path, text, c, c.grammar ? gs[c.grammar] : null, `b:${path}`);
    });
    const p = runPipeline(input(files, { "package.json": src["package.json"] as string, "server/package.json": src["server/package.json"] as string }));
    const routes = mainFacts(p, "route")
      .map((f) => (f.kind === "route" ? `${f.method} ${f.pattern} ${f.framework} ${f.path}:${f.line} ${f.handler ?? "-"}` : ""))
      .sort();
    expect(routes).toEqual([
      "ANY /api/legacy next-pages pages/api/legacy.ts:1 pages/api/legacy.ts#handler",
      "DELETE /api/items next-app app/api/items/route.ts:7 app/api/items/route.ts#del",
      "GET / next-app app/page.tsx:4 app/page.tsx#Page",
      "GET /api/items next-app app/api/items/route.ts:1 app/api/items/route.ts#GET",
      "POST /api/items next-app app/api/items/route.ts:5 app/api/items/route.ts#POST",
    ]);
  });
});

describe("gen #4a entry.web@1: the module script a web page loads (Vite index.html)", () => {
  test("webEntries resolves `/x` and `./x` against the page's directory; URLs and classic scripts are none", () => {
    const got = webEntries({
      file: { path: "excalidraw-app/index.html", lang: "generic", class: "source", scope: "main" },
      text: [
        '<script src="/legacy.js"></script>',
        '<script type="module" src="/index.tsx"></script>',
        "<script type='module' src='./boot.ts?v=2'></script>",
        '<script type="module" src="https://cdn.example.com/m.js"></script>',
        '<script type="module" src="//cdn.example.com/m.js"></script>',
        '<script type="module">import "./inline.ts";</script>',
      ].join("\n"),
    });
    expect(got.map((c) => `${c.line} ${c.data.label}`)).toEqual(["2 excalidraw-app/index.tsx", "3 excalidraw-app/boot.ts"]);
  });

  test("the link keeps a page's entry only when its script is a file of the repo", () => {
    const cand = (label: string, line: number) => ({
      detector: "entry.web@1",
      kind: "entry" as const,
      path: "web/index.html",
      line,
      data: { entry: "main", label },
      evidence: [],
      scope: "main" as const,
    });
    const files = [sf("web/index.html", { lang: "generic", facts: [cand("web/src/main.tsx", 9), cand("web/src/gone.tsx", 10)] }), sf("web/src/main.tsx")];
    const inp = input(files);
    const entries = linkFacts(inp, resolveImports(inp)).facts.filter((f) => f.kind === "entry");
    expect(entries.map((f) => (f.kind === "entry" ? `${f.path}:${f.line} ${f.entry} ${f.label}` : ""))).toEqual(["web/index.html:9 main web/src/main.tsx"]);
  });
});

describe("NC-10 outbound.calls@2: HTTP, SDK / DB clients, RPC, subprocesses and write sinks", () => {
  const outbound = async (src: Record<string, string>) => {
    const gs = await loadGrammars();
    const files = Object.entries(src).map(([path, text]) => {
      const c = classify(path, text.length, text);
      return parseStageFile(path, text, c, c.grammar ? gs[c.grammar] : null, `b:${path}`);
    });
    const p = runPipeline(input(files, src["go.mod"] ? { "go.mod": src["go.mod"] } : {}));
    return mainFacts(p, "outbound")
      .map((f) => (f.kind === "outbound" ? `${f.path}:${f.line} ${f.channel} ${f.via}${f.target ? ` → ${f.target}` : ""}` : ""))
      .sort();
  };

  test("literal file writes use known bindings or built-ins; dynamic paths, read modes and unrelated names do not count", async () => {
    const got = await outbound({
      "src/output.ts":
        'import * as fs from "node:fs";\nimport { writeFile } from "node:fs/promises";\nfs.writeFile("out/report.json", "PAYLOAD_CANARY", () => {});\nwriteFile("out/cache.json", data);\nfs.writeFile(dynamic, "must-not-be-target.txt");\nfs.readFile("input.json");\n// fs.writeFile("comment.json", data);\n',
      "src/local.ts": 'const fs = { writeFile() {} };\nfs.writeFile("local.json", data);\n',
      "app/output.py":
        'with open("out/report.txt", "w") as f:\n    f.write("PAYLOAD_CANARY")\nopen("out/log.txt", mode="a")\nopen("input.txt", "r")\nopen(dynamic, "w")\n',
      "app/local.py": 'def open(path, mode):\n    pass\nopen("local.txt", "w")\n',
      "main.go":
        'package main\nimport "os"\nfunc main() {\n _ = os.WriteFile("out/report.txt", []byte("PAYLOAD_CANARY"), 0600)\n _, _ = os.Create("out/new.txt")\n _ = os.WriteFile(dynamic, data, 0600)\n}\n',
      "src/main.rs":
        'use std::fs;\nfn main() {\n fs::write("out/report.txt", "PAYLOAD_CANARY").unwrap();\n std::fs::write("out/cache.txt", data).unwrap();\n fs::write(dynamic, data).unwrap();\n}\n',
    });
    expect(got).toEqual([
      "app/output.py:1 write_sink builtins.open → out/report.txt",
      "app/output.py:3 write_sink builtins.open → out/log.txt",
      "main.go:4 write_sink os → out/report.txt",
      "main.go:5 write_sink os → out/new.txt",
      "src/main.rs:3 write_sink std::fs → out/report.txt",
      "src/main.rs:4 write_sink std::fs → out/cache.txt",
      "src/output.ts:3 write_sink node:fs → out/report.json",
      "src/output.ts:4 write_sink node:fs/promises → out/cache.json",
    ]);
  });

  test("direct DB clients executing literal write SQL record only the operation, not queries, values or prepare-only calls", async () => {
    const got = await outbound({
      "src/db.ts":
        'import { Pool } from "pg";\nconst db = new Pool();\ndb.query("INSERT INTO users (token) VALUES ($1)", ["VALUE_CANARY"]);\ndb.query("SELECT * FROM users");\ndb.query(sql);\ndb.prepare("DELETE FROM users");\nfunction unrelated(db) { db.query("DROP TABLE fake"); }\n',
      "src/local.ts": 'const db = { execute() {} };\ndb.execute("DELETE FROM local");\n',
      "app/db.py":
        'import sqlite3\ndb = sqlite3.connect("db.sqlite")\ndb.execute("UPDATE users SET token = ?", ["VALUE_CANARY"])\ndb.execute("SELECT token FROM users")\n',
      "main.go":
        'package main\nimport "database/sql"\nfunc main() {\n db, _ := sql.Open("sqlite", "db.sqlite")\n _, _ = db.ExecContext(ctx, "DELETE FROM users WHERE token = ?", "VALUE_CANARY")\n}\n',
      "src/main.rs":
        'use rusqlite::Connection;\nfn main() {\n let db = Connection::open("db.sqlite").unwrap();\n db.execute("INSERT INTO users VALUES (?1)", ["VALUE_CANARY"]).unwrap();\n}\n',
    });
    expect(got).toEqual([
      "app/db.py:2 db sqlite3",
      "app/db.py:3 db sqlite3 → UPDATE",
      "main.go:4 db database/sql",
      "main.go:5 db database/sql → DELETE",
      "src/db.ts:2 db pg",
      "src/db.ts:3 db pg → INSERT",
      "src/main.rs:3 db rusqlite",
      "src/main.rs:4 db rusqlite → INSERT",
    ]);
  });

  test("Go: net/http, os/exec, database/sql, an external NewClient; comments, strings and in-repo clients are not calls", async () => {
    const got = await outbound({
      "go.mod": "module example.com/app\n\ngo 1.22\n",
      "internal/meta/fetch.go": [
        "package meta",
        "import (",
        '\t"database/sql"',
        '\t"net/http"',
        '\t"os/exec"',
        '\tgh "github.com/google/go-github/v57/github"',
        '\t"example.com/app/internal/store"',
        ")",
        "func run() {",
        '\t_, _ = http.Get("https://api.example.com/v1/books?token=abc")',
        '\t_, _ = http.NewRequestWithContext(ctx, http.MethodGet, base+"/x", nil)',
        '\t_ = exec.Command("git", "status")',
        '\t_, _ = sql.Open("sqlite", path)',
        "\t_ = gh.NewClient(nil)",
        "\t_ = store.NewClient()",
        '\t// http.Get("https://commented.example.com")',
        '\t_ = "exec.Command(rm)"',
        "}",
        "",
      ].join("\n"),
      "internal/store/store.go": "package store\n\ntype Client struct{}\n\nfunc NewClient() *Client { return &Client{} }\n",
    });
    expect(got).toEqual([
      "internal/meta/fetch.go:10 http net/http → https://api.example.com",
      "internal/meta/fetch.go:11 http net/http",
      "internal/meta/fetch.go:12 subprocess os/exec → git",
      "internal/meta/fetch.go:13 db database/sql",
      "internal/meta/fetch.go:14 sdk github.com/google/go-github/v57/github",
    ]);
  });

  test("TS / JS: fetch, axios, WebSocket, child_process, SDK and DB clients; SDK commands, operators and RegExp.exec are not", async () => {
    const got = await outbound({
      "src/api.ts": [
        'import axios from "axios";',
        'import { spawn } from "node:child_process";',
        'import { PrismaClient } from "@prisma/client";',
        'import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";',
        'import { eq } from "drizzle-orm";',
        "export async function go(url: string) {",
        '  await fetch("/api/books?page=2");',
        "  await fetch(url);",
        '  await axios.get("https://api.github.com/repos/x");',
        '  spawn("git", ["status"]);',
        "  /x/.exec(url);",
        "  const db = new PrismaClient();",
        "  const s3 = new S3Client({});",
        "  await s3.send(new PutObjectCommand({}));",
        "  eq(1, 2);",
        '  const ws = new WebSocket("wss://collab.example.com/room/1");',
        "}",
        "",
      ].join("\n"),
      "src/local.ts": "function fetch(a: number) { return a; }\nexport const x = fetch(1);\n",
    });
    expect(got).toEqual([
      "src/api.ts:10 subprocess child_process → git",
      "src/api.ts:12 db @prisma/client",
      "src/api.ts:13 sdk @aws-sdk/client-s3",
      "src/api.ts:16 http WebSocket → wss://collab.example.com",
      "src/api.ts:7 http fetch → /api/books",
      "src/api.ts:8 http fetch",
      "src/api.ts:9 http axios → https://api.github.com",
    ]);
  });

  test("TS: a socket.io connection (default import through a hinted dynamic import), firebase's Firestore (DB) and Storage factories", async () => {
    // excalidraw's collaboration room and its firebase data layer were missing from §8
    const got = await outbound({
      "app/collab.ts": [
        "export async function connect(url: string) {",
        "  const { default: socketIOClient } = await import(",
        '    /* webpackChunkName: "socketIoClient" */ "socket.io-client"',
        "  );",
        '  return socketIOClient(url, { transports: ["websocket"] });',
        "}",
        "",
      ].join("\n"),
      "app/live.ts": 'import { io } from "socket.io-client";\nexport const s = io("https://live.example.com/socket");\n',
      "app/firebase.ts": [
        'import { initializeApp } from "firebase/app";',
        'import { getFirestore, doc } from "firebase/firestore";',
        'import { getStorage, ref } from "firebase/storage";',
        "let firestore: ReturnType<typeof getFirestore> | null = null;",
        "export const init = () => {",
        "  const app = initializeApp({});",
        "  firestore = getFirestore(app);",
        '  return [getStorage(app), doc(firestore, "x"), ref(getStorage(app))];',
        "};",
        "",
      ].join("\n"),
    });
    expect(got).toEqual([
      "app/collab.ts:5 http socket.io-client",
      "app/firebase.ts:6 sdk firebase/app",
      "app/firebase.ts:7 db firebase/firestore",
      "app/firebase.ts:8 sdk firebase/storage",
      "app/live.ts:2 http socket.io-client → https://live.example.com",
    ]);
  });

  test("Python: requests (aliased), urlopen, subprocess, sqlite3, boto3; comments and in-repo clients are not", async () => {
    const got = await outbound({
      "app/net.py": [
        "import subprocess",
        "import sys",
        "import sqlite3",
        "import boto3",
        "import requests as rq",
        "from urllib.request import urlopen",
        "from app.clients import FooClient",
        "def go():",
        '    rq.get("https://api.github.com/repos")',
        '    urlopen("http://localhost:8000/health")',
        '    subprocess.call([sys.executable, "-m", "uvicorn", "app:api"])',
        '    sqlite3.connect("x.db")',
        '    boto3.client("s3")',
        "    FooClient()",
        '    # rq.get("https://commented.example.com")',
        "",
      ].join("\n"),
      "app/clients.py": "class FooClient:\n    pass\n",
      "app/__init__.py": "",
    });
    expect(got).toEqual([
      "app/net.py:10 http urllib.request → http://localhost:8000",
      "app/net.py:11 subprocess subprocess → uvicorn",
      "app/net.py:12 db sqlite3",
      "app/net.py:13 sdk boto3",
      "app/net.py:9 http requests → https://api.github.com",
    ]);
  });

  test("Rust: std::process::Command and reqwest are calls; clap::Command and a local fetch() are not", async () => {
    const got = await outbound({
      "src/run.rs": [
        "use std::process::Command;",
        "pub fn go() {",
        '    let _ = Command::new("git").arg("status").output();',
        '    let _ = reqwest::blocking::get("https://crates.io/api/v1/crates");',
        "}",
        "",
      ].join("\n"),
      "src/cli.rs": [
        "use clap::Command;",
        "fn fetch(t: u8, isbn: &str) -> u8 { t }",
        "pub fn cli() {",
        '    let _ = Command::new("indexer");',
        '    let _ = fetch(1, "x");',
        "}",
        "",
      ].join("\n"),
    });
    expect(got).toEqual(["src/run.rs:3 subprocess std::process → git", "src/run.rs:4 http reqwest → https://crates.io"]);
  });

  test("the fixtures' real calls: go-small's request, py-small's uvicorn, ts-small's spawnSync, mixed's upstream fetch", async () => {
    for (const [name, want] of [
      ["go-small", /^internal\/meta\/fetch\.go:\d+ http net\/http$/],
      ["py-small", /^tsundoku\/cli\.py:\d+ subprocess subprocess → uvicorn$/],
      ["ts-small", /^bin\/tsundoku\.js:\d+ subprocess child_process/],
      ["mixed", /^web\/lib\/upstream\.ts:\d+ http fetch$/],
    ] as const) {
      const repo = await buildFixture(name);
      built.push(repo);
      const p = runPipeline((await loadRepo(repo.root)).input);
      const got = mainFacts(p, "outbound").map((f) =>
        f.kind === "outbound" ? `${f.path}:${f.line} ${f.channel} ${f.via}${f.target ? ` → ${f.target}` : ""}` : "",
      );
      expect({ name, hit: got.some((g) => want.test(g)), got }).toMatchObject({ name, hit: true });
      // test files never contribute (ts-small's test/repo.test.ts calls fetch)
      expect(got.some((g) => g.startsWith("test/"))).toBe(false);
    }
  }, 60_000);
});

describe("IDX-AT-25 entry.go@1", () => {
  test("a `//go:build ignore` generator main is labelled by its path, the package main by its directory", async () => {
    const gs = await loadGrammars();
    const src: Record<string, string> = {
      "cmd/x/main.go": `package main\n\nfunc main() {}\n`,
      "cmd/x/gen.go": `//go:build ignore\n\n// gen writes the table.\npackage main\n\nfunc main() {}\n`,
    };
    const files = Object.entries(src).map(([path, text]) => parseStageFile(path, text, classify(path, text.length, text), gs.go, `b:${path}`));
    const p = runPipeline(input(files));
    expect(mainFacts(p, "entry").map((e) => (e.kind === "entry" ? `${e.entry}:${e.label}` : ""))).toEqual(["main:cmd/x/gen.go", "main:cmd/x"]);
  });
});

describe("IDX-AT-25 entry.testmain@1", () => {
  test("`func TestMain(m *testing.M)` is a test_main entry that keeps its test scope (not in the main entry table)", async () => {
    const gs = await loadGrammars();
    const src: Record<string, string> = {
      "internal/db/db_test.go": `package db\n\nimport (\n\t"os"\n\t"testing"\n)\n\nfunc TestMain(m *testing.M) {\n\tos.Exit(m.Run())\n}\n\nfunc TestOpen(t *testing.T) {}\n`,
      "internal/db/other_test.go": `package db\n\n// func TestMain(m *testing.M) in a comment\nfunc TestMainly(t *testing.T) {}\n`,
    };
    const files = Object.entries(src).map(([path, text]) => parseStageFile(path, text, classify(path, text.length, text), gs.go, `b:${path}`));
    const inp = input(files);
    const p = runPipeline(inp);
    const entries = p.facts.facts.filter((f) => f.kind === "entry");
    expect(entries).toEqual([
      expect.objectContaining({ detector: "entry.testmain@1", entry: "test_main", label: "internal/db", path: "internal/db/db_test.go", line: 8 }),
    ]);
    expect(mainFacts(p, "entry")).toEqual([]);
    expect(p.facts.facts.filter((f) => f.kind === "test").map((f) => (f.kind === "test" ? f.name : ""))).toEqual(["TestMain", "TestOpen", "TestMainly"]);
  });
});

describe("IDX-AT-26 / IDX-AT-45 secrets in fact text are redacted at link time (spec §5.1)", () => {
  test("script arguments, dependency URLs, TODO text, doc titles and literal write sinks", async () => {
    const gs = await loadGrammars();
    const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
    const aws = "AKIA4F7Q2Z9XWJ3KLM8N";
    const sources: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "x",
        scripts: { deploy: `curl -H "Authorization: token ${token}" https://api.example.org` },
        dependencies: { priv: `git+https://bot:${token}@github.com/acme/priv.git` },
      }),
      "src/a.ts": `// TODO: rotate ${aws} before release\nexport const a = 1;\n`,
      "src/write.ts": `import { writeFile } from "node:fs/promises";\nwriteFile("out/${token}.txt", "VALUE_CANARY");\n`,
      "README.md": `# Setup with ${token}\n`,
    };
    const files = Object.entries(sources).map(([path, text]) => {
      const c = classify(path, text.length, text);
      return parseStageFile(path, text, c, c.grammar ? gs[c.grammar] : null, `b:${path}`);
    });
    const inp = input(files, { "package.json": sources["package.json"] as string });
    const plain = JSON.stringify(linkFacts(inp, resolveImports(inp)).facts);
    expect(plain).toContain(token);
    expect(plain).toContain(aws);
    const facts = linkFacts(inp, resolveImports(inp), { secrets: createSecretScanner() }).facts;
    const json = JSON.stringify(facts);
    expect(json).not.toContain(token);
    expect(json).not.toContain(aws);
    expect(facts.find((f) => f.kind === "script")).toMatchObject({ name: "deploy" });
    expect(facts.find((f) => f.kind === "todo" && f.text.includes(REDACTION_TOKEN))).toBeDefined();
    expect(facts.find((f) => f.kind === "dependency")).toMatchObject({ name: "priv", ecosystem: "npm" });
    expect(facts.find((f) => f.kind === "outbound")).toMatchObject({ channel: "write_sink", target: `out/${REDACTION_TOKEN}.txt` });
    expect(json).not.toContain("VALUE_CANARY");
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
