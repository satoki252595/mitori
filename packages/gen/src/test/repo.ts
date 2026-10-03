/** A tiny TypeScript repository used by gen tests (4 leaf modules + 1 parent, one route, one entry). */
import type { Fact, ModuleId, RepoPath, SymbolKind } from "@mitori/core";

/** A symbol of the sample repo. */
export interface RepoSymbol {
  /** Name. */
  name: string;
  /** Qualified name. */
  qualname: string;
  /** Kind. */
  kind: SymbolKind;
  /** Lines. */
  start: number;
  /** Last line. */
  end: number;
  /** Exported. */
  exported: boolean;
}

/** A module of the sample repo. */
export interface RepoModule {
  /** Id. */
  id: ModuleId;
  /** Slug. */
  slug: string;
  /** Provisional name. */
  name: string;
  /** Member files (leaves). */
  paths: RepoPath[];
  /** Children (parents). */
  children: ModuleId[];
  /** Parent. */
  parent?: ModuleId;
  /** Rank. */
  rank: number;
  /** Topological order. */
  topoOrder: number;
  /** Outgoing deps. */
  deps: { module: ModuleId; weight: number }[];
}

/** A fact without its blob (the fake fills it in). */
export type RepoFact = Fact extends infer F ? (F extends Fact ? Omit<F, "blob"> : never) : never;

/** Repo description consumed by `createFakeIndexer`. */
export interface FakeRepo {
  /** File texts. */
  files: Record<RepoPath, string>;
  /** Symbols per file. */
  symbols: Record<RepoPath, RepoSymbol[]>;
  /** Modules. */
  modules: RepoModule[];
  /** Facts (blob filled by the fake). */
  facts: RepoFact[];
}

export const M_SESSION = "md_a0000001" as ModuleId;
export const M_AUTH = "md_a0000002" as ModuleId;
export const M_HTTP = "md_a0000003" as ModuleId;
export const M_CLI = "md_a0000004" as ModuleId;
export const M_CORE = "md_p0000001" as ModuleId;

const lines = (...l: string[]) => `${l.join("\n")}\n`;

/** The sample repository. */
export function sampleRepo(): FakeRepo {
  return {
    files: {
      "README.md": lines("# Tsundoku", "", "Tsundoku keeps a reading list for one person.", "Run `bun src/cli/main.ts <user>` to log in."),
      "src/session/store.ts": lines(
        "// Session store keeps sessions in memory.",
        "export interface Session {",
        "  id: string;",
        "  expiresAt: number;",
        "}",
        "",
        "export class Store {",
        "  private items = new Map<string, Session>();",
        "",
        "  get(id: string): Session | undefined {",
        "    const s = this.items.get(id);",
        "    if (!s) return undefined;",
        "    if (s.expiresAt < now()) throw new ErrExpired(id);",
        "    return s;",
        "  }",
        "",
        "  put(s: Session): void {",
        "    this.items.set(s.id, s);",
        "  }",
        "}",
        "",
        "export class ErrExpired extends Error {}",
        "function now(): number {",
        "  return 0;",
        "}",
      ),
      "src/auth/login.ts": lines(
        'import { Store } from "../session/store";',
        "",
        "export function login(store: Store, user: string): string {",
        '  const id = user + "-session";',
        "  store.put({ id, expiresAt: 0 });",
        "  return id;",
        "}",
      ),
      "src/http/server.ts": lines(
        'import { login } from "../auth/login";',
        'import { Store } from "../session/store";',
        "",
        "const store = new Store();",
        "export function handleLogin(user: string): string {",
        "  return login(store, user);",
        "}",
      ),
      "src/cli/main.ts": lines('import { handleLogin } from "../http/server";', 'console.log(handleLogin(process.argv[2] ?? "guest"));'),
    },
    symbols: {
      "src/session/store.ts": [
        { name: "Session", qualname: "Session", kind: "interface", start: 2, end: 5, exported: true },
        { name: "Store", qualname: "Store", kind: "class", start: 7, end: 20, exported: true },
        { name: "get", qualname: "Store.get", kind: "method", start: 10, end: 15, exported: true },
        { name: "put", qualname: "Store.put", kind: "method", start: 17, end: 19, exported: true },
        { name: "ErrExpired", qualname: "ErrExpired", kind: "class", start: 22, end: 22, exported: true },
        { name: "now", qualname: "now", kind: "function", start: 23, end: 25, exported: false },
      ],
      "src/auth/login.ts": [{ name: "login", qualname: "login", kind: "function", start: 3, end: 7, exported: true }],
      "src/http/server.ts": [{ name: "handleLogin", qualname: "handleLogin", kind: "function", start: 5, end: 7, exported: true }],
      "src/cli/main.ts": [],
    },
    modules: [
      {
        id: M_SESSION,
        slug: "session",
        name: "session Store",
        paths: ["src/session/store.ts"],
        children: [],
        parent: M_CORE,
        rank: 0.9,
        topoOrder: 0,
        deps: [],
      },
      {
        id: M_AUTH,
        slug: "auth",
        name: "auth login",
        paths: ["src/auth/login.ts"],
        children: [],
        parent: M_CORE,
        rank: 0.6,
        topoOrder: 1,
        deps: [{ module: M_SESSION, weight: 0.8 }],
      },
      {
        id: M_HTTP,
        slug: "http",
        name: "http handleLogin",
        paths: ["src/http/server.ts"],
        children: [],
        rank: 0.7,
        topoOrder: 2,
        deps: [
          { module: M_AUTH, weight: 0.7 },
          { module: M_SESSION, weight: 0.5 },
        ],
      },
      { id: M_CLI, slug: "cli", name: "cli main", paths: ["src/cli/main.ts"], children: [], rank: 0.3, topoOrder: 3, deps: [{ module: M_HTTP, weight: 0.9 }] },
      { id: M_CORE, slug: "core", name: "core", paths: [], children: [M_SESSION, M_AUTH], rank: 0.8, topoOrder: 4, deps: [] },
    ],
    facts: [
      {
        kind: "route",
        detector: "route.test@1",
        path: "src/http/server.ts",
        line: 5,
        method: "POST",
        pattern: "/login",
        handler: "src/http/server.ts#handleLogin",
        framework: "test",
      },
      { kind: "entry", detector: "entry.test@1", path: "src/cli/main.ts", line: 1, entry: "main", label: "cli/main" },
      { kind: "existing_doc", detector: "doc.test@1", path: "README.md", line: 1, role: "readme", title: "Tsundoku" },
    ],
  };
}
