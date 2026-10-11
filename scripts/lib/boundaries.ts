// Package-boundary rules (ADR-0010, ARCHITECTURE §3.3, contracts/testing.md §1/§3). Pure: callers pass sources.
import { PACKAGE_DEPS, type PackageName } from "@mitori/core";
import ts from "typescript";

export interface Violation {
  file: string;
  line: number;
  col: number;
  rule: "deps" | "deep-import" | "testing-import" | "runtime-api" | "direct-io" | "nondeterminism" | "manifest";
  message: string;
}

/** Packages allowed to touch Bun/Node APIs (composition and adapters). */
const RUNTIME_OK: ReadonlySet<string> = new Set(["@mitori/platform", "@mitori/server", "@mitori/cli"]);
/** The only package allowed to write files, spawn processes and read the clock/entropy directly. */
const IO_OK: ReadonlySet<string> = new Set(["@mitori/platform"]);

const NODE_BUILTINS: ReadonlySet<string> = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);
const FS_MODULES: ReadonlySet<string> = new Set(["fs", "fs/promises", "node:fs", "node:fs/promises"]);
const PROC_MODULES: ReadonlySet<string> = new Set(["child_process", "node:child_process"]);
const FS_WRITES: ReadonlySet<string> = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "rename",
  "renameSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "symlink",
  "symlinkSync",
  "link",
  "linkSync",
  "chmod",
  "chmodSync",
  "truncate",
  "truncateSync",
  "createWriteStream",
]);
const PROC_CALLS: ReadonlySet<string> = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
const BUN_IO: ReadonlySet<string> = new Set(["write", "spawn", "spawnSync", "$"]);

export interface FileInfo {
  /** Repo-relative POSIX path. */
  path: string;
  /** Owning workspace package (`@mitori/<x>`), or null for test zones / tooling outside packages. */
  pkg: string | null;
  /** Test code (unit tests, `src/testing.ts`, testkit, bench/eval/e2e, `test/` dirs). */
  test: boolean;
}

/** Classify a repo-relative path. Returns null for files the checker ignores. */
export function classify(path: string): FileInfo | null {
  if (!/\.(ts|tsx|mts|cts|svelte)$/.test(path) || path.endsWith(".d.ts")) return null;
  const m = /^(packages|apps)\/([^/]+)\//.exec(path);
  const zone = /^(bench|eval|e2e|test)\//.test(path);
  if (!m && !zone) return null;
  const pkg = m ? `@mitori/${m[2]}` : null;
  const test =
    zone ||
    pkg === "@mitori/testkit" ||
    /(^|\/)(test|tests|__tests__)\//.test(path) ||
    /\.(test|spec)\.(ts|tsx)$/.test(path) ||
    /\/src\/testing\.ts$/.test(path);
  return { path, pkg, test };
}

function scriptOf(path: string, text: string): string {
  if (!path.endsWith(".svelte")) return text;
  // keep line numbers: blank everything outside <script> blocks
  let out = "";
  let at = 0;
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const bodyStart = m.index + m[0].indexOf(">") + 1;
    out += text.slice(at, bodyStart).replace(/[^\n]/g, " ");
    out += m[1];
    at = bodyStart + (m[1]?.length ?? 0);
  }
  return out + text.slice(at).replace(/[^\n]/g, " ");
}

const pkgOfSpecifier = (spec: string): { pkg: string; sub: string | null } | null => {
  const m = /^(@mitori\/[^/]+)(?:\/(.+))?$/.exec(spec);
  return m ? { pkg: m[1] as string, sub: m[2] ?? null } : null;
};

/** Check one file's source. */
export function checkSource(info: FileInfo, text: string): Violation[] {
  const out: Violation[] = [];
  const src = ts.createSourceFile(info.path, scriptOf(info.path, text), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const at = (node: ts.Node, rule: Violation["rule"], message: string) => {
    const { line, character } = src.getLineAndCharacterOfPosition(node.getStart(src));
    out.push({ file: info.path, line: line + 1, col: character + 1, rule, message });
  };
  const own = info.pkg;
  const deps: readonly string[] = own && own in PACKAGE_DEPS ? PACKAGE_DEPS[own as PackageName] : [];
  const runtimeOk = info.test || (own !== null && RUNTIME_OK.has(own));
  const ioOk = info.test || (own !== null && IO_OK.has(own));
  // The browser app has no injected Clock/Random ports (UI timers, idempotency keys); it is exempt from the
  // determinism rules but still may not write files or spawn (it cannot anyway).
  const entropyOk = ioOk || own === "@mitori/web" || own === "@mitori/share";
  const fsBindings = new Set<string>();
  const procBindings = new Set<string>();

  const checkSpecifier = (node: ts.Node, spec: string, typeOnly: boolean) => {
    const target = pkgOfSpecifier(spec);
    if (target) {
      if (target.pkg === "@mitori/testkit" && !info.test) at(node, "testing-import", "production code may not import @mitori/testkit");
      if (target.sub !== null) {
        const testkitHelper = target.pkg === "@mitori/testkit" && (target.sub === "fixtures" || target.sub === "golden" || target.sub === "home");
        if (target.sub !== "testing" && !testkitHelper) at(node, "deep-import", `deep import "${spec}": import from the package index only`);
        else if (!info.test) at(node, "testing-import", `production code may not import "${spec}" (test-only subpath)`);
      }
      if (own && target.pkg === own) {
        if (target.sub === null) at(node, "deps", `self-import "${spec}": use a relative import inside the package`);
      } else if (own && own in PACKAGE_DEPS && !(typeOnly && target.pkg === "@mitori/core")) {
        const allowed = deps.includes(target.pkg) || (info.test && target.pkg === "@mitori/testkit");
        if (!allowed) at(node, "deps", `${own} may not import ${target.pkg} (PACKAGE_DEPS: ${deps.join(", ") || "none"})`);
      }
      return;
    }
    if (spec.startsWith(".")) {
      const segs = info.path.split("/");
      const base = segs.slice(0, -1);
      for (const s of spec.split("/")) {
        if (s === "..") base.pop();
        else if (s !== ".") base.push(s);
      }
      const resolved = base.join("/");
      const root = /^((packages|apps)\/[^/]+)\//.exec(info.path)?.[1];
      if (root && !resolved.startsWith(`${root}/`)) at(node, "deep-import", `relative import "${spec}" leaves ${root}: import other packages by name`);
      return;
    }
    const isBun = spec === "bun" || spec.startsWith("bun:");
    const isNode = spec.startsWith("node:") || NODE_BUILTINS.has(spec);
    // ADR-0010 R3: doc roots use native lexical path operations, with filesystem access still behind FsReader.
    const docPath = own === "@mitori/doc" && spec === "node:path";
    if ((isBun || isNode) && !runtimeOk && !typeOnly && !docPath)
      at(node, "runtime-api", `"${spec}" is only allowed in platform/server/cli (domain code takes ports)`);
  };

  const recordBindings = (decl: ts.ImportDeclaration, spec: string) => {
    const set = FS_MODULES.has(spec) ? fsBindings : PROC_MODULES.has(spec) ? procBindings : null;
    if (!set || !decl.importClause) return;
    const banned = set === fsBindings ? FS_WRITES : PROC_CALLS;
    const c = decl.importClause;
    if (c.name) set.add(c.name.text);
    const nb = c.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) set.add(nb.name.text);
    if (nb && ts.isNamedImports(nb))
      for (const el of nb.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (banned.has(imported) && !ioOk)
          at(el, "direct-io", `direct ${imported} from "${spec}": write/spawn only via @mitori/platform (SafeWriter / Spawner)`);
        if (imported === "promises") set.add(el.name.text);
      }
  };

  /** `a.b.c` → ["a","b","c"]; null unless the chain is identifiers only (calls/elements break it). */
  const chainParts = (e: ts.Expression): string[] | null => {
    const names: string[] = [];
    while (ts.isPropertyAccessExpression(e)) {
      names.unshift(e.name.text);
      e = e.expression;
    }
    return ts.isIdentifier(e) ? [e.text, ...names] : null;
  };
  const rootIdent = (e: ts.Expression): ts.Identifier | null => {
    while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) e = e.expression;
    return ts.isIdentifier(e) ? e : null;
  };
  /** `await import("m")` / `require("m")` (parenthesized or not) → "m". */
  const loadedModule = (e: ts.Expression | undefined): string | null => {
    while (e && (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression;
    if (!e || !ts.isCallExpression(e)) return null;
    const arg = e.arguments[0];
    const loader = e.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e.expression) && e.expression.text === "require");
    return loader && arg && ts.isStringLiteralLike(arg) ? arg.text : null;
  };

  /** `const fs = require("fs")`, `const { spawn } = await import("node:child_process")`, `const { write } = Bun`. */
  const bindDeclaration = (decl: ts.VariableDeclaration) => {
    const spec = loadedModule(decl.initializer);
    const set = spec === null ? null : FS_MODULES.has(spec) ? fsBindings : PROC_MODULES.has(spec) ? procBindings : null;
    const parts = decl.initializer ? chainParts(decl.initializer) : null;
    const isBun = parts?.join(".").replace(/^(globalThis|window|self)\./, "") === "Bun";
    if (ts.isIdentifier(decl.name)) {
      set?.add(decl.name.text);
      return;
    }
    if (!ts.isObjectBindingPattern(decl.name) || (!set && !isBun)) return;
    for (const el of decl.name.elements) {
      const key = el.propertyName ?? el.name;
      if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) continue;
      const name = key.text;
      if (isBun) {
        if (!runtimeOk) at(el, "runtime-api", `Bun.${name} is only allowed in platform/server/cli`);
        else if (BUN_IO.has(name) && !ioOk) at(el, "direct-io", `Bun.${name}: write/spawn only via @mitori/platform`);
      } else if (set) {
        if ((set === fsBindings ? FS_WRITES : PROC_CALLS).has(name) && !ioOk)
          at(el, "direct-io", `direct ${name} from "${spec}": write/spawn only via @mitori/platform (SafeWriter / Spawner)`);
        if (name === "promises" && ts.isIdentifier(el.name)) set.add(el.name.text);
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) bindDeclaration(node);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.importClause;
      const typeOnly =
        !!c &&
        (c.isTypeOnly ||
          (!c.name &&
            !!c.namedBindings &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every((e) => e.isTypeOnly)));
      checkSpecifier(node, node.moduleSpecifier.text, typeOnly);
      recordBindings(node, node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      checkSpecifier(node, node.moduleSpecifier.text, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      checkSpecifier(node, node.argument.literal.text, true);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg = node.arguments[0];
      if ((callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) && arg && ts.isStringLiteralLike(arg)) {
        checkSpecifier(node, arg.text, false);
      }
    } else if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      // outermost member chain only (`a.b.c`), compared without whitespace / optional chaining
      const parts = chainParts(node);
      const root = parts ? rootIdent(node) : null;
      const head = !parts ? [] : parts[0] === "globalThis" || parts[0] === "window" || parts[0] === "self" ? parts.slice(1) : parts;
      const [obj, prop] = head;
      if (obj === "Bun" && prop) {
        if (!runtimeOk) at(node, "runtime-api", `Bun.${prop} is only allowed in platform/server/cli`);
        else if (BUN_IO.has(prop) && !ioOk) at(node, "direct-io", `Bun.${prop}: write/spawn only via @mitori/platform`);
      }
      if (obj === "process" && prop && !runtimeOk) at(node, "runtime-api", `process.${prop}: domain code is isomorphic (inject what you need)`);
      if (!entropyOk && obj === "crypto" && (prop === "getRandomValues" || prop === "randomUUID"))
        at(node, "nondeterminism", `crypto.${prop}: use the Random port (core newId)`);
      if (!entropyOk && obj === "Math" && prop === "random") at(node, "nondeterminism", "Math.random: use the Random port");
      if (!entropyOk && obj === "Date" && prop === "now") at(node, "nondeterminism", "Date.now: use the Clock port");
      if (root && !ioOk && (fsBindings.has(root.text) || procBindings.has(root.text))) {
        const banned = fsBindings.has(root.text) ? FS_WRITES : PROC_CALLS;
        const hit = parts?.slice(1).find((p) => banned.has(p));
        if (hit) at(node, "direct-io", `${root.text}.${hit}: write/spawn only via @mitori/platform`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

/** Workspace manifest checks: @mitori deps ⊆ PACKAGE_DEPS, exact third-party pins, no lifecycle-script trust. */
export function checkManifest(path: string, json: unknown, opts: { root?: boolean } = {}): Violation[] {
  const out: Violation[] = [];
  const v = (message: string) => out.push({ file: path, line: 1, col: 1, rule: "manifest", message });
  const pj = json as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; trustedDependencies?: unknown };
  if (opts.root && !(Array.isArray(pj.trustedDependencies) && pj.trustedDependencies.length === 0))
    v("root package.json must declare `trustedDependencies: []` (no dependency lifecycle scripts, SEC-16)");
  const name = pj.name ?? "";
  const allowed: readonly string[] | null = name in PACKAGE_DEPS ? PACKAGE_DEPS[name as PackageName] : null;
  for (const [field, deps] of [
    ["dependencies", pj.dependencies],
    ["devDependencies", pj.devDependencies],
  ] as const) {
    for (const [dep, ver] of Object.entries(deps ?? {})) {
      if (dep.startsWith("@mitori/")) {
        if (ver !== "workspace:*") v(`${field}.${dep} must be "workspace:*"`);
        if (allowed && !allowed.includes(dep)) v(`${name} may not depend on ${dep} (PACKAGE_DEPS)`);
        if (dep === "@mitori/testkit" && field === "dependencies" && allowed) v(`${name}: @mitori/testkit is test-only`);
      } else if (!/^(npm:[^@]+@)?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(ver)) {
        v(`${field}.${dep} must be pinned to an exact version (got "${ver}")`);
      }
    }
  }
  return out;
}
