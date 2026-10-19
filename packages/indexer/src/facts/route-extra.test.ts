import { describe, expect, test } from "bun:test";
import { input } from "../resolve/test/stage-files.ts";
import { classify, loadGrammars, parseStageFile } from "../structure/test/corpus.ts";
import { mainFacts, runPipeline } from "../structure/test/pipeline.ts";

/** Route facts of inline sources through the real S1–S4 (the gen #4c tests' style). */
async function routesOf(src: Record<string, string>) {
  const gs = await loadGrammars();
  const files = Object.entries(src).map(([path, text]) => {
    const c = classify(path, text.length, text);
    return parseStageFile(path, text, c, c.grammar ? gs[c.grammar] : null, `b:${path}`);
  });
  const p = runPipeline(input(files));
  return mainFacts(p, "route")
    .map((f) => (f.kind === "route" ? `${f.method} ${f.pattern} ${f.framework} ${f.path}:${f.line} ${f.handler ?? "-"}` : ""))
    .sort();
}

describe("WP32 route.axum@1: axum Router routes and nests", () => {
  test("route() methods (incl. chained) and nest() prefixes become route facts; files without axum give none", async () => {
    const got = await routesOf({
      "src/api.rs": [
        "use axum::{Router, routing::{get, post}};",
        "pub fn build() -> Router {",
        "    Router::new()",
        '        .route("/workspaces", axum::routing::get(workspaces_handler))',
        '        .route("/search", get(search_handler).post(search_post_handler))',
        '        .route("/hook", post(hook_handler))',
        "}",
        "async fn workspaces_handler() {}",
        "async fn search_handler() {}",
        "async fn search_post_handler() {}",
        "async fn hook_handler() {}",
        "",
      ].join("\n"),
      "src/mount.rs": ["use axum::Router;", "pub fn mount(api: Router) -> Router {", '    axum::Router::new().nest("/api/v1", api)', "}", ""].join("\n"),
      // no axum import: a `.route(` lookalike is not a route
      "src/other.rs": ["fn r() {", '    x.route("/nope", get(h))', "}", ""].join("\n"),
    });
    expect(got).toEqual([
      "ANY /api/v1 axum src/mount.rs:3 -",
      "GET /search axum src/api.rs:5 src/api.rs#search_handler",
      "GET /workspaces axum src/api.rs:4 src/api.rs#workspaces_handler",
      "POST /hook axum src/api.rs:6 src/api.rs#hook_handler",
      "POST /search axum src/api.rs:5 src/api.rs#search_post_handler",
    ]);
  });
});

describe("WP32 route.actix@1: actix-web attribute and resource routes", () => {
  test("method attributes and web::resource().route() become route facts; files without actix-web give none", async () => {
    const got = await routesOf({
      "src/handlers.rs": [
        "use actix_web::{get, post, web, HttpResponse};",
        '#[get("/hook")]',
        "async fn hook() -> HttpResponse { HttpResponse::Ok().finish() }",
        '#[post("/handoff")]',
        "async fn handoff() -> HttpResponse { HttpResponse::Ok().finish() }",
        "pub fn config(cfg: &mut web::ServiceConfig) {",
        '    cfg.service(web::resource("/workstream/runs").route(web::get().to(list_runs)).route(web::post().to(create_run)));',
        "}",
        "async fn list_runs() -> HttpResponse { HttpResponse::Ok().finish() }",
        "async fn create_run() -> HttpResponse { HttpResponse::Ok().finish() }",
        "",
      ].join("\n"),
      "src/other.rs": ['#[get("/nope")]', "async fn nope() {}", ""].join("\n"),
    });
    expect(got).toEqual([
      "GET /hook actix src/handlers.rs:2 src/handlers.rs#hook",
      "GET /workstream/runs actix src/handlers.rs:7 src/handlers.rs#list_runs",
      "POST /handoff actix src/handlers.rs:4 src/handlers.rs#handoff",
      "POST /workstream/runs actix src/handlers.rs:7 src/handlers.rs#create_run",
    ]);
  });
});

describe("WP32 route.mcp@1: MCP tool registrations", () => {
  test("TS server.tool/registerTool with the MCP SDK import; sdk-less files and non-string forms give none", async () => {
    const got = await routesOf({
      "src/server.ts": [
        'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
        "const server = new McpServer({ name: 'x', version: '1.0.0' });",
        'server.tool("memory_query", "search memory", shape, handleQuery);',
        'server.registerTool("memory_write", { description: "write", inputSchema: shape }, async (args) => result(args));',
        "export function handleQuery(a: unknown) { return a; }",
        "",
      ].join("\n"),
      // the SDK is not imported here: a `.tool(` lookalike is not an MCP tool
      "src/other.ts": ['server.tool("nope", "x", {}, handler);', "export function handler(a: unknown) { return a; }", ""].join("\n"),
    });
    expect(got).toEqual(["TOOL memory_query mcp src/server.ts:3 src/server.ts#handleQuery", "TOOL memory_write mcp src/server.ts:4 -"]);
  });

  test("Python @mcp.tool() / @app.tool(); files without an mcp import give none", async () => {
    const got = await routesOf({
      "app/server.py": [
        "from mcp.server.fastmcp import FastMCP",
        "mcp = FastMCP('demo')",
        "@mcp.tool()",
        "def memory_query(q: str) -> str:",
        "    return q",
        '@app.tool("memory_write")',
        "def write_page(title: str) -> str:",
        "    return title",
        "",
      ].join("\n"),
      "app/other.py": ["@mcp.tool()", "def nope() -> str:", "    return 'x'", ""].join("\n"),
    });
    expect(got).toEqual(["TOOL memory_query mcp app/server.py:3 app/server.py#memory_query", "TOOL memory_write mcp app/server.py:6 app/server.py#write_page"]);
  });

  test("Rust #[tool] fns with the rmcp import; tool_router / missing import give none", async () => {
    const got = await routesOf({
      "src/server.rs": [
        "use rmcp::{handler::server::router::tool::ToolRouter, tool, tool_router};",
        "#[tool_router]",
        "impl Server {",
        "    fn new() -> Self { Self }",
        '    #[tool(description = "search memory")]',
        "    async fn memory_query(&self) {}",
        '    #[tool(name = "memory_write", description = "write")]',
        "    async fn write_page(&self) {}",
        "}",
        "",
      ].join("\n"),
      "src/other.rs": ['#[tool(description = "x")]', "async fn nope() {}", ""].join("\n"),
    });
    expect(got).toEqual([
      "TOOL memory_query mcp src/server.rs:6 src/server.rs#Server.memory_query",
      "TOOL memory_write mcp src/server.rs:8 src/server.rs#Server.write_page",
    ]);
  });
});
