/**
 * `outbound.calls@1` (NC-10, §8 「外とのやり取り」) [CR rdoc-1]: where the code talks to the outside world — HTTP
 * requests, SDK / database clients being created, RPC dials, subprocesses — for TS / JS, Go, Python and Rust. A call
 * counts only when the library is imported (a local `fetch(transport, …)` in Rust or `clap::Command::new` is not
 * one) and the name is code (the tree says identifier, not string or comment). Arguments are never captured; the
 * target is a literal only: an http(s) origin (no path, no query) or a relative API path, or a command name.
 */
import type { FactCandidate, FactExtractInput } from "../contract.ts";
import { candidate } from "./candidate.ts";
import { type Node, stringValue, type Tree } from "./tsq.ts";

type Channel = "http" | "rpc" | "sdk" | "db" | "subprocess";
/** `spec`: a generic rule's import (`new XxxClient(`); the link drops it when the import resolves into the repo. */
type Hit = { at: number; channel: Channel; via: string; target?: "url" | "cmd"; spec?: string };

const IDENT = new Set(["identifier", "property_identifier", "field_identifier", "type_identifier", "package_identifier", "shorthand_property_identifier"]);
const CALLS = new Set(["call_expression", "call", "new_expression", "macro_invocation"]);

/** The name at `at` is code (an identifier node), not text inside a string or a comment. */
function isCode(tree: Tree | null, at: number): boolean {
  if (tree === null) return false;
  const n = tree.rootNode.descendantForIndex(at);
  return n !== null && IDENT.has(n.type);
}

/** The call around the name at `at` (its first ancestor that is a call). */
function callAt(tree: Tree, at: number): Node | null {
  let n: Node | null = tree.rootNode.descendantForIndex(at);
  for (let i = 0; n && i < 6; i++, n = n.parent) if (CALLS.has(n.type)) return n;
  return null;
}

/** `https://api.github.com/x?y` → `https://api.github.com`; `/api/books?x` → `/api/books`; else null. */
export function urlTarget(s: string): string | null {
  const abs = /^(https?|wss?):\/\/([A-Za-z0-9.-]+(?::\d{2,5})?)(?:[/?#]|$)/.exec(s);
  if (abs) return `${abs[1]}://${abs[2]}`;
  const rel = /^\/[A-Za-z0-9._~/{}:-]{0,80}/.exec(s);
  return rel ? (rel[0] as string).replace(/\/+$/, "") || "/" : null;
}

/** `"git"`, `"/usr/bin/git status"` → `git` (a word a reader knows; paths and flags dropped). */
export function cmdTarget(s: string): string | null {
  const word = s.trim().split(/\s+/)[0] ?? "";
  const base = word.slice(word.lastIndexOf("/") + 1);
  return /^[A-Za-z0-9][\w.+-]{0,39}$/.test(base) ? base : null;
}

/** The literal target of a call: the first URL-like string among its first three arguments, or the command name. */
function targetOf(call: Node | null, kind: "url" | "cmd"): string | null {
  const args = call?.childForFieldName("arguments")?.namedChildren.filter((a): a is Node => a !== null && a.type !== "comment") ?? [];
  const lit = (n: Node | undefined): string | null => {
    if (!n) return null;
    if (n.type === "array" || n.type === "list" || n.type === "array_expression" || n.type === "macro_invocation")
      return (
        (n.type === "macro_invocation" ? (n.namedChildren.find((c) => c?.type === "token_tree") ?? null) : n)?.namedChildren
          .map((c) => stringValue(c))
          .find((v): v is string => v !== null && !v.startsWith("-")) ?? null
      );
    return stringValue(n);
  };
  for (const a of args.slice(0, 3)) {
    const v = lit(a);
    if (v === null) continue;
    const t = kind === "url" ? urlTarget(v) : cmdTarget(v);
    if (t !== null) return t;
    if (kind === "cmd") return null; // the command is the first literal
  }
  return null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (xs: Iterable<string>) => [...xs].map(esc).join("|");

/* ------------------------------------------------------------------ TS / JS */

/** Package → channel for client constructors / factories (`new Pool(`, `createClient(`, `new OpenAI(`). */
const JS_PACKAGES: readonly [RegExp, Channel][] = [
  [
    /^(pg|postgres|mysql2?|sqlite3|better-sqlite3|bun:sqlite|@libsql\/client|@prisma\/client|mongodb|mongoose|redis|ioredis|@upstash\/redis|knex|typeorm|sequelize|kysely|drizzle-orm(\/.*)?|@neondatabase\/serverless|@planetscale\/database|cassandra-driver|neo4j-driver|@google-cloud\/firestore|@aws-sdk\/client-dynamodb)$/,
    "db",
  ],
  [/^(@grpc\/grpc-js|@connectrpc\/.+|@bufbuild\/connect.*)$/, "rpc"],
  [
    /^(@aws-sdk\/.+|aws-sdk|openai|@anthropic-ai\/sdk|stripe|@supabase\/supabase-js|firebase(\/.*)?|firebase-admin(\/.*)?|@google-cloud\/.+|googleapis|@google\/genai|@google\/generative-ai|@octokit\/.+|octokit|@slack\/.+|twilio|@sendgrid\/.+|resend|nodemailer|@sentry\/.+|posthog-node|@linear\/sdk|discord\.js|algoliasearch|@elastic\/elasticsearch|@notionhq\/client|cohere-ai|@mistralai\/mistralai|replicate|@vercel\/(blob|kv)|@upstash\/qstash|amqplib|kafkajs)$/,
    "sdk",
  ],
];
const JS_HTTP_LIBS: Readonly<Record<string, string>> = { axios: "axios", ky: "ky", got: "got", ofetch: "ofetch", superagent: "superagent", undici: "undici" };
/** One pass over the text decides whether a file can hold a call at all (most components and utilities cannot). */
const JS_PRECHECK =
  /\bfetch\s*\(|["'](axios|ky|got|ofetch|superagent|undici|(node:)?https?|(node:)?child_process|execa)["']|XMLHttpRequest|WebSocket|EventSource|Bun\.spawn|Deno\.Command|Client\s*\(|["'](pg|postgres|mysql2?|sqlite3|better-sqlite3|bun:sqlite|mongodb|mongoose|redis|ioredis|knex|typeorm|sequelize|kysely|stripe|openai|twilio|resend|nodemailer|googleapis|octokit|algoliasearch|replicate|amqplib|kafkajs|drizzle-orm|aws-sdk|firebase|firebase-admin|discord\.js|cohere-ai|posthog-node)["'/]|["']@(prisma|libsql|upstash|neondatabase|planetscale|aws-sdk|anthropic-ai|supabase|google-cloud|google|octokit|slack|sendgrid|sentry|linear|elastic|notionhq|mistralai|vercel|grpc|connectrpc|bufbuild)\//;
const isExternal = (spec: string) => !/^(\.|\/|@\/|~\/|#|node:|bun$|bun:test$)/.test(spec);

/** Local bindings of a JS module: named / default imports (`ImportRecord.names`), `* as x`, `const x = require("m")`. */
function jsBindings(input: FactExtractInput): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of input.imports) if (i.kind !== "type") for (const n of i.names) out.set(n, i.spec);
  // the statements themselves (named imports with `as`, a default next to braces), never `import type`
  for (const m of input.text.matchAll(/\bimport\s+(?!type\b)(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]{0,600})\})?\s*from\s*["']([^"']+)["']/g)) {
    const spec = m[3] as string;
    if (m[1]) out.set(m[1], spec);
    for (const part of (m[2] ?? "").split(",")) {
      const p = part.trim();
      if (p === "" || p.startsWith("type ")) continue;
      const local = (p.split(/\s+as\s+/).pop() ?? "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) out.set(local, spec);
    }
  }
  for (const m of input.text.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g)) out.set(m[1] as string, m[2] as string);
  for (const m of input.text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+import|require)\(\s*["']([^"']+)["']\s*\)/g))
    out.set(m[1] as string, m[2] as string);
  for (const m of input.text.matchAll(/\b(?:const|let|var)\s*\{([^}]{1,400})\}\s*=\s*(?:await\s+import|require)\(\s*["']([^"']+)["']\s*\)/g))
    for (const part of (m[1] as string).split(",")) {
      const local = (part.split(":").pop() ?? "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) out.set(local, m[2] as string);
    }
  return out;
}

function jsHits(input: FactExtractInput): Hit[] {
  const text = input.text;
  if (!JS_PRECHECK.test(text)) return [];
  const binds = jsBindings(input);
  const out: Hit[] = [];
  const scan = (re: RegExp, f: (m: RegExpMatchArray) => Hit | null) => {
    for (const m of text.matchAll(re)) {
      const h = f(m);
      if (h) out.push(h);
    }
  };
  // fetch: the platform's own, unless the file defines its own `fetch`
  if (!/\b(?:function|const|let|var|class)\s+fetch\b/.test(text))
    scan(/(?<![\w$.])fetch\s*\(/g, (m) =>
      binds.has("fetch") && !/node-fetch|undici|cross-fetch|isomorphic-fetch/.test(binds.get("fetch") ?? "")
        ? null
        : { at: m.index ?? 0, channel: "http", via: "fetch", target: "url" },
    );
  for (const [name, spec] of binds) {
    const lib = JS_HTTP_LIBS[spec];
    if (lib)
      scan(new RegExp(`(?<![\\w$.])${esc(name)}(?:\\.(?:get|post|put|patch|delete|head|request|create|fetch))?\\s*\\(`, "g"), (m) => ({
        at: m.index ?? 0,
        channel: "http",
        via: lib,
        target: "url",
      }));
  }
  const nodeHttp = [...binds].filter(([, s]) => /^(node:)?https?$/.test(s)).map(([n]) => n);
  if (nodeHttp.length > 0)
    scan(new RegExp(`(?<![\\w$.])(?:${alt(nodeHttp)})\\.(?:request|get)\\s*\\(`, "g"), (m) => ({
      at: m.index ?? 0,
      channel: "http",
      via: "node:http",
      target: "url",
    }));
  scan(/\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/g, (m) => ({
    at: (m.index ?? 0) + m[0].indexOf(m[1] as string),
    channel: "http",
    via: m[1] as string,
    target: "url",
  }));
  // subprocesses: child_process bindings, Bun.spawn, execa, Deno.Command
  const cp = [...binds].filter(([, s]) => /^(node:)?child_process$/.test(s)).map(([n]) => n);
  const cpFns = cp.filter((n) => /^(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/.test(n));
  const cpNs = cp.filter((n) => !cpFns.includes(n));
  if (cpFns.length > 0)
    scan(new RegExp(`(?<![\\w$.])(?:${alt(cpFns)})\\s*\\(`, "g"), (m) => ({ at: m.index ?? 0, channel: "subprocess", via: "child_process", target: "cmd" }));
  if (cpNs.length > 0)
    scan(new RegExp(`(?<![\\w$.])(?:${alt(cpNs)})\\.(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\\s*\\(`, "g"), (m) => ({
      at: m.index ?? 0,
      channel: "subprocess",
      via: "child_process",
      target: "cmd",
    }));
  scan(/\bBun\.(spawn|spawnSync)\s*\(/g, (m) => ({ at: m.index ?? 0, channel: "subprocess", via: "Bun.spawn", target: "cmd" }));
  scan(/\bnew\s+Deno\.Command\s*\(/g, (m) => ({ at: (m.index ?? 0) + 4, channel: "subprocess", via: "Deno.Command", target: "cmd" }));
  const execa = [...binds].filter(([, s]) => s === "execa").map(([n]) => n);
  if (execa.length > 0)
    scan(new RegExp(`(?<![\\w$.])(?:${alt(execa)})\\s*\\(`, "g"), (m) => ({ at: m.index ?? 0, channel: "subprocess", via: "execa", target: "cmd" }));
  // SDK / database clients: constructors and factories of known packages; `new XxxClient(` of any external one
  for (const [name, spec] of binds) {
    if (!isExternal(spec) || JS_HTTP_LIBS[spec] || /child_process|^execa$/.test(spec)) continue;
    const known = JS_PACKAGES.find(([re]) => re.test(spec))?.[1];
    if (known) {
      // a command / input / type object of an SDK is no client (`new PutObjectCommand(`), an operator no factory (`eq(`)
      if (/(Command|Input|Output|Schema|Type|Error|Exception|Options|Config)$/.test(name)) continue;
      const bare = /^(create\w*|connect\w*|drizzle|postgres|knex|mongoose|init\w*|\w*Client)$/i.test(name) ? `|${esc(name)}` : "";
      const re = new RegExp(
        `(?<![\\w$.])(?:new\\s+${esc(name)}|${esc(name)}\\.(?:connect|createClient|createPool|createConnection|initializeApp|init|client|Client|Pool)${bare})\\s*\\(`,
        "g",
      );
      scan(re, (m) => ({ at: (m.index ?? 0) + m[0].indexOf(name), channel: known, via: spec }));
    } else if (/Client$/.test(name))
      scan(new RegExp(`(?<![\\w$.])new\\s+${esc(name)}\\s*\\(`, "g"), (m) => ({ at: (m.index ?? 0) + m[0].indexOf(name), channel: "sdk", via: spec, spec }));
  }
  return out;
}

/* ------------------------------------------------------------------ Go */

/** import path (prefix) → [functions, channel]; `via` is the import path. */
const GO_CALLS: readonly [RegExp, RegExp, Channel][] = [
  [/^net\/http$/, /^(Get|Post|Head|PostForm|NewRequest|NewRequestWithContext)$/, "http"],
  [/^github\.com\/go-resty\/resty(\/v\d+)?$/, /^New$/, "http"],
  [/^os\/exec$/, /^(Command|CommandContext)$/, "subprocess"],
  [/^syscall$/, /^(Exec|ForkExec)$/, "subprocess"],
  [/^database\/sql$/, /^(Open|OpenDB)$/, "db"],
  [/^github\.com\/jmoiron\/sqlx$/, /^(Connect|Open|MustConnect|MustOpen)$/, "db"],
  [/^github\.com\/jackc\/pgx(\/v\d+)?$/, /^(Connect|ConnectConfig)$/, "db"],
  [/^github\.com\/jackc\/pgx(\/v\d+)?\/pgxpool$/, /^(New|NewWithConfig|Connect)$/, "db"],
  [/^gorm\.io\/gorm$/, /^Open$/, "db"],
  [/^github\.com\/(redis|go-redis)\/(go-)?redis(\/v\d+)?$/, /^(NewClient|NewClusterClient|NewUniversalClient)$/, "db"],
  [/^go\.mongodb\.org\/mongo-driver(\/v\d+)?\/mongo$/, /^(Connect|NewClient)$/, "db"],
  [/^(go\.etcd\.io\/bbolt|github\.com\/boltdb\/bolt|github\.com\/dgraph-io\/badger(\/v\d+)?)$/, /^Open$/, "db"],
  [/^google\.golang\.org\/grpc$/, /^(Dial|DialContext|NewClient)$/, "rpc"],
  [/^github\.com\/aws\/aws-sdk-go-v2\/config$/, /^LoadDefaultConfig$/, "sdk"],
  [/^github\.com\/aws\/aws-sdk-go-v2\/service\/.+$/, /^(NewFromConfig|New)$/, "sdk"],
];

function goAlias(spec: string, explicit: string | undefined): string {
  if (explicit !== undefined && explicit !== "" && explicit !== "_" && explicit !== ".") return explicit;
  const segs = spec.split("/");
  let last = segs[segs.length - 1] ?? spec;
  if (/^v\d+$/.test(last) && segs.length > 1) last = segs[segs.length - 2] as string;
  return last
    .replace(/^go-/, "")
    .replace(/[.-]go$/, "")
    .replace(/[^A-Za-z0-9_]/g, "_");
}

function goHits(input: FactExtractInput): Hit[] {
  const out: Hit[] = [];
  for (const imp of input.imports) {
    const alias = goAlias(imp.spec, imp.names[0]);
    const rule = GO_CALLS.find(([spec]) => spec.test(imp.spec));
    // any external module's `NewClient(` is an SDK client (stdlib paths have no dot in their first segment)
    const fns = rule ? rule[1] : /\./.test(imp.spec.split("/")[0] ?? "") ? /^NewClient$/ : null;
    if (!fns) continue;
    const channel: Channel = rule ? rule[2] : "sdk";
    for (const m of input.text.matchAll(new RegExp(`(?<![\\w.])${esc(alias)}\\.([A-Z]\\w*)\\s*\\(`, "g"))) {
      if (!fns.test(m[1] as string)) continue;
      out.push({
        at: m.index ?? 0,
        channel,
        via: imp.spec,
        ...(channel === "http" ? { target: "url" as const } : channel === "subprocess" ? { target: "cmd" as const } : {}),
        ...(rule ? {} : { spec: imp.spec }),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Python */

const PY_CALLS: readonly [RegExp, RegExp, Channel][] = [
  [/^(requests|httpx)$/, /^(get|post|put|patch|delete|head|options|request|stream|Session|Client|AsyncClient)$/, "http"],
  [/^urllib\.request$/, /^(urlopen|Request)$/, "http"],
  [/^(aiohttp|urllib3)$/, /^(ClientSession|request|PoolManager)$/, "http"],
  [/^subprocess$/, /^(run|call|check_call|check_output|Popen|getoutput|getstatusoutput)$/, "subprocess"],
  [/^os$/, /^(system|popen|execv|execvp|execve|execl|execlp|spawnv|spawnvp|posix_spawn)$/, "subprocess"],
  [/^asyncio$/, /^(create_subprocess_exec|create_subprocess_shell)$/, "subprocess"],
  [/^(sqlite3|psycopg2|psycopg|pymysql|MySQLdb|asyncpg|aiosqlite|duckdb)$/, /^(connect|create_pool)$/, "db"],
  [/^sqlalchemy(\.ext\.asyncio)?$/, /^(create_engine|create_async_engine)$/, "db"],
  [/^(redis|redis\.asyncio)$/, /^(Redis|StrictRedis|from_url)$/, "db"],
  [/^(pymongo|motor\.motor_asyncio)$/, /^(MongoClient|AsyncIOMotorClient)$/, "db"],
  [/^elasticsearch$/, /^(Elasticsearch|AsyncElasticsearch)$/, "db"],
  [/^(grpc|grpc\.aio)$/, /^(insecure_channel|secure_channel)$/, "rpc"],
  [/^(boto3|botocore\.session)$/, /^(client|resource|Session|get_session)$/, "sdk"],
  [/^(openai|anthropic)$/, /^(OpenAI|AsyncOpenAI|AzureOpenAI|Anthropic|AsyncAnthropic)$/, "sdk"],
  [/^(slack_sdk|slack_sdk\.web|twilio\.rest|firebase_admin|stripe)$/, /^(WebClient|Client|initialize_app|StripeClient)$/, "sdk"],
  [/^google\.cloud(\..+)?$/, /^Client$/, "sdk"],
];

/** `import a.b as c` / `from a.b import c as d`: local name → (module, imported name or null for a module). */
function pyBindings(text: string): Map<string, { module: string; name: string | null }> {
  const out = new Map<string, { module: string; name: string | null }>();
  for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm))
    for (const part of (m[1] as string).split(",")) {
      const [mod, as] = part.trim().split(/\s+as\s+/);
      if (!mod) continue;
      if (as) out.set(as, { module: mod, name: null });
      else {
        out.set(mod, { module: mod, name: null }); // `import urllib.request` → `urllib.request.urlopen(`
        out.set(mod.split(".")[0] as string, { module: mod.split(".")[0] as string, name: null });
      }
    }
  // `from x import a, b as c` (one line) and `from x import (\n a,\n b,\n)`
  for (const m of text.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(?:\(([^)]{0,2000})\)|([^\n#]+))/gm))
    for (const part of (m[2] ?? m[3] ?? "").split(",")) {
      const [name, as] = part.trim().split(/\s+as\s+/);
      if (name && /^\w+$/.test(name)) out.set(as?.trim() || name, { module: m[1] as string, name });
    }
  return out;
}

function pyHits(input: FactExtractInput): Hit[] {
  const binds = pyBindings(input.text);
  if (binds.size === 0) return [];
  const out: Hit[] = [];
  const hit = (module: string, fn: string, at: number) => {
    const rule = PY_CALLS.find(([mod, fns]) => mod.test(module) && fns.test(fn));
    if (rule)
      out.push({
        at,
        channel: rule[2],
        via: module,
        ...(rule[2] === "http" ? { target: "url" as const } : rule[2] === "subprocess" ? { target: "cmd" as const } : {}),
      });
    else if (/Client$/.test(fn) && /^[A-Z]/.test(fn) && !module.startsWith(".") && !isPyStdlib(module))
      out.push({ at, channel: "sdk", via: module, spec: module });
  };
  for (const m of input.text.matchAll(/(?<![\w.])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g)) {
    const chain = (m[1] as string).split(".");
    const at = m.index ?? 0;
    const fn = chain[chain.length - 1] as string;
    if (chain.length === 1) {
      const b = binds.get(fn);
      if (b?.name) hit(b.module, b.name, at);
      continue;
    }
    // `requests.get(` / `urllib.request.urlopen(` / `rq.get(` (an aliased module)
    for (let k = chain.length - 1; k >= 1; k--) {
      const head = chain.slice(0, k).join(".");
      const b = binds.get(head) ?? (k > 1 ? binds.get(chain[0] as string) : undefined);
      if (!b) continue;
      const module = b.name === null ? (binds.has(head) ? b.module : `${b.module}.${chain.slice(1, k).join(".")}`) : `${b.module}.${b.name}`;
      hit(module, fn, at);
      break;
    }
  }
  return out;
}

const PY_STDLIB_HEADS = new Set([
  "os",
  "sys",
  "re",
  "json",
  "typing",
  "collections",
  "functools",
  "itertools",
  "logging",
  "pathlib",
  "dataclasses",
  "enum",
  "abc",
  "http",
  "email",
  "xml",
  "concurrent",
  "multiprocessing",
  "threading",
  "queue",
  "unittest",
]);
const isPyStdlib = (module: string) => PY_STDLIB_HEADS.has(module.split(".")[0] as string);

/* ------------------------------------------------------------------ Rust */

function rustHits(input: FactExtractInput): Hit[] {
  const text = input.text;
  const out: Hit[] = [];
  const uses = (re: RegExp) => re.test(text);
  const scan = (re: RegExp, channel: Channel, via: string, target?: "url" | "cmd") => {
    for (const m of text.matchAll(re)) out.push({ at: m.index ?? 0, channel, via, ...(target ? { target } : {}) });
  };
  scan(/\breqwest::(?:blocking::)?(?:get|Client::new|Client::builder|ClientBuilder::new)\s*\(/g, "http", "reqwest", "url");
  if (uses(/\buse\s+reqwest::(?:blocking::)?(?:Client\b|\{[^}]*\bClient\b)/)) scan(/(?<![\w:])Client::(?:new|builder)\s*\(/g, "http", "reqwest");
  scan(/\bureq::(?:get|post|put|delete|request|agent)\s*\(/g, "http", "ureq", "url");
  scan(/\b(?:std|tokio)::process::Command::new\s*\(/g, "subprocess", "std::process", "cmd");
  if (uses(/\buse\s+(?:std|tokio)::process::(?:Command\b|\{[^}]*\bCommand\b)/) && !uses(/\buse\s+clap::(?:Command\b|\{[^}]*\bCommand\b)/))
    scan(/(?<![\w:])Command::new\s*\(/g, "subprocess", uses(/\buse\s+tokio::process/) ? "tokio::process" : "std::process", "cmd");
  scan(/\brusqlite::Connection::open(?:_in_memory)?\s*\(/g, "db", "rusqlite");
  if (uses(/\buse\s+rusqlite::(?:Connection\b|\{[^}]*\bConnection\b)/)) scan(/(?<![\w:])Connection::open(?:_in_memory)?\s*\(/g, "db", "rusqlite");
  scan(/\b(?:sqlx::)?(?:PgPool|SqlitePool|MySqlPool|AnyPool)::connect(?:_with)?\s*\(/g, "db", "sqlx");
  scan(/\bredis::Client::open\s*\(/g, "db", "redis");
  scan(/\b(?:tokio_)?postgres::(?:Client::)?connect\s*\(/g, "db", "postgres");
  scan(/\bmongodb::Client::with_uri_str\s*\(/g, "db", "mongodb");
  scan(/\btonic::transport::(?:Channel|Endpoint)::from_(?:static|shared)\s*\(/g, "rpc", "tonic");
  return out;
}

/* ------------------------------------------------------------------ entry */

/** Outbound call candidates of one file (Worker side, while the tree is alive). */
export function outboundCalls(input: FactExtractInput, tree: Tree): FactCandidate[] {
  if (input.file.scope === "test") return [];
  const lang = input.file.lang;
  const hits =
    lang === "go"
      ? goHits(input)
      : lang === "python"
        ? pyHits(input)
        : lang === "rust"
          ? rustHits(input)
          : lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "jsx"
            ? jsHits(input)
            : [];
  const out: FactCandidate[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    // skip `new ` / a qualifier to the name the tree must call code
    const nameAt = h.at + (/^new\s+/.exec(input.text.slice(h.at, h.at + 8))?.[0].length ?? 0);
    if (!isCode(tree, nameAt)) continue;
    const call = h.target ? callAt(tree, nameAt) : null;
    const target = h.target ? targetOf(call, h.target) : null;
    const line = tree.rootNode.descendantForIndex(nameAt)?.startPosition.row ?? 0;
    const key = `${line}\u0000${h.channel}\u0000${h.via}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      candidate("outbound.calls@1", "outbound", input, line + 1, {
        channel: h.channel,
        via: h.via,
        ...(target !== null ? { target } : {}),
        ...(h.spec !== undefined ? { spec: h.spec } : {}),
      }),
    );
  }
  return out;
}
