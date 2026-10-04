// Typecheck / test / lint gate detection (spec §7.6.1, the `typecheck` and `test:related` columns; ADR-0013). Like the
// format detectors nothing is executed: binaries are repo-local (`node_modules/.bin`, `.venv/bin`) or toolchains on
// SAFE_PATH, never a download path. Every gate here executes repository code (`executesRepoCode: true`): a package
// script, a type checker that loads plugins / build scripts, or a test runner — so without an OS sandbox it waits for
// the human's consent on an AI diff (SEC-03), and it always needs trust.
//
// Dependency re-trust (RT-31): the trust hash of these gates covers the lockfile of the gate's directory (its blob id
// from the index), so a dependency change asks for trust again before AI-written code runs against new dependencies.
import type { GateArg, GateSpec, RepoPath } from "@mitori/core";
import { GATE_TIMEOUTS, type GateDetector } from "../contract.ts";
import {
  ancestors,
  byManifest,
  configCandidates,
  type DetectEnv,
  type DetectInput,
  detectFormatGates,
  dirOf,
  gateTrustHash,
  join,
  nearestConfig,
  nested,
  onPath,
  repoLocal,
} from "./detect.ts";

const FILES: GateArg = { var: "files" };
const PKGS: GateArg = { var: "pkgs" };
const TESTS: GateArg = { var: "tests" };

type Config = { path: RepoPath; text: string };

/** Lockfiles whose identity is part of a check gate's trust hash (nearest first). */
export const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "go.sum",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
] as const;

/** Package manager by lockfile (nearest directory first); npm when there is none. */
export function packageManager(input: DetectInput, dir: string): "bun" | "pnpm" | "yarn" | "npm" {
  const present = new Set(input.files.map((f) => f.path));
  for (const d of ancestors(dir)) {
    if (present.has(join(d, "bun.lock")) || present.has(join(d, "bun.lockb"))) return "bun";
    if (present.has(join(d, "pnpm-lock.yaml"))) return "pnpm";
    if (present.has(join(d, "yarn.lock"))) return "yarn";
    if (present.has(join(d, "package-lock.json"))) return "npm";
  }
  return "npm";
}

/** The lockfiles of `dir` and its ancestors as trust-hash inputs (path + blob id; the text itself is never read). */
function lockConfigs(input: DetectInput, dir: string, names: readonly string[]): Config[] {
  const byPath = new Map(input.files.map((f) => [f.path, f.blob]));
  const out: Config[] = [];
  for (const d of ancestors(dir)) {
    for (const n of names) {
      const blob = byPath.get(join(d, n));
      if (blob) out.push({ path: join(d, n), text: `blob ${blob}` });
    }
  }
  return out;
}

const idAt = (kind: string, name: string, cwd: string) => (cwd === "" ? `${kind}:${name}` : `${kind}:${name}@${cwd}`) as GateSpec["id"];

function check(
  env: DetectEnv,
  kind: "typecheck" | "test" | "lint",
  f: Omit<GateSpec, "trustHash" | "kind" | "autofix" | "timeoutMs" | "source" | "executesRepoCode">,
  configs: Config[],
): GateSpec {
  const base: Omit<GateSpec, "trustHash"> = { ...f, kind, autofix: false, executesRepoCode: true, timeoutMs: GATE_TIMEOUTS[kind], source: "detected" };
  return { ...base, trustHash: gateTrustHash(env.hasher, base, configs) };
}

/* ---- Go ------------------------------------------------------------------------------------------------------ */

function goChecks(env: DetectEnv): GateDetector {
  return {
    id: "gates.go-check@1",
    detect(input) {
      const out: GateSpec[] = [];
      const go = onPath(env, input, "go");
      if (!go) return out;
      for (const [cwd] of byManifest(input, ["go.mod"], /\.go$/)) {
        const configs = [{ path: join(cwd, "go.mod"), text: input.readConfig(join(cwd, "go.mod")) ?? "" }, ...lockConfigs(input, cwd, ["go.sum"])];
        const appliesTo = ["**/*.go", ...nested(input, ["go.mod"], cwd)];
        // `./dir` package patterns never start with "-": no `--` (the go command does not take one before packages)
        out.push(
          check(env, "typecheck", { id: idAt("typecheck", "go-vet", cwd), argvTemplate: [go, "vet", PKGS], endOfOptions: false, cwd, appliesTo }, configs),
        );
        out.push(
          check(env, "test", { id: idAt("test", "go", cwd), argvTemplate: [go, "test", "-count=1", PKGS], endOfOptions: false, cwd, appliesTo }, configs),
        );
      }
      return out;
    },
  };
}

/* ---- JS / TS ------------------------------------------------------------------------------------------------- */

const JS_EXT = /\.(?:[cm]?[jt]sx?)$/;
const JS_GLOB = "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}";
/** Test file names of the bun / jest / vitest conventions. */
export const JS_TEST_RE = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|__tests__\/[^/]+\.[cm]?[jt]sx?)$/;

function scriptsOf(pkg: string): Record<string, string> {
  try {
    const s = (JSON.parse(pkg) as { scripts?: unknown }).scripts;
    if (s === null || typeof s !== "object" || Array.isArray(s)) return {};
    return Object.fromEntries(Object.entries(s as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}
const hasDep = (pkg: string, name: string) => new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"\\s*:`).test(pkg);

function jsChecks(env: DetectEnv): GateDetector {
  return {
    id: "gates.js-check@1",
    detect(input) {
      const out: GateSpec[] = [];
      for (const [cwd] of byManifest(input, ["package.json"], JS_EXT)) {
        const pkg = input.readConfig(join(cwd, "package.json")) ?? "";
        const pm = packageManager(input, cwd);
        const locks = lockConfigs(input, cwd, ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"]);
        const manifest = { path: join(cwd, "package.json"), text: pkg };
        const appliesTo = [JS_GLOB, ...nested(input, ["package.json"], cwd)];
        // typecheck: a package script first (the repo's own definition), else tsc on the nearest tsconfig
        const scripts = scriptsOf(pkg);
        const script = ["typecheck", "check-types", "tsc"].find((n) => n in scripts);
        const pmBin = onPath(env, input, pm);
        const tsconfig = input.readConfig(join(cwd, "tsconfig.json"));
        const tsc = repoLocal(env, input, cwd, "node_modules/.bin/tsc");
        if (script && pmBin) {
          out.push(
            check(env, "typecheck", { id: idAt("typecheck", pm, cwd), argvTemplate: [pmBin, "run", script], endOfOptions: false, cwd, appliesTo }, [
              manifest,
              ...locks,
            ]),
          );
        } else if (tsconfig !== null && tsc) {
          out.push(
            check(
              env,
              "typecheck",
              { id: idAt("typecheck", "tsc", cwd), argvTemplate: [tsc, "--noEmit", "-p", "tsconfig.json"], endOfOptions: false, cwd, appliesTo },
              [manifest, { path: join(cwd, "tsconfig.json"), text: tsconfig }, ...locks],
            ),
          );
        }
        // test:related — vitest, jest, then bun's own runner when the package uses bun and has conventional tests
        const vitest = hasDep(pkg, "vitest") ? repoLocal(env, input, cwd, "node_modules/.bin/vitest") : null;
        const jest = hasDep(pkg, "jest") ? repoLocal(env, input, cwd, "node_modules/.bin/jest") : null;
        const prefix = cwd === "" ? "" : `${cwd}/`;
        const conventional = input.files.some((f) => f.path.startsWith(prefix) && JS_TEST_RE.test(f.path));
        const cfg = (names: readonly string[]) => nearestConfig(input, cwd, names);
        if (vitest) {
          const c = cfg(["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts", "vite.config.js"]);
          out.push(
            check(env, "test", { id: idAt("test", "vitest", cwd), argvTemplate: [vitest, "related", "--run", FILES], endOfOptions: false, cwd, appliesTo }, [
              manifest,
              ...(c ? [c] : []),
              ...locks,
            ]),
          );
        } else if (jest) {
          const c = cfg(["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs", "jest.config.json"]);
          out.push(
            check(
              env,
              "test",
              { id: idAt("test", "jest", cwd), argvTemplate: [jest, "--findRelatedTests", "--passWithNoTests", FILES], endOfOptions: false, cwd, appliesTo },
              [manifest, ...(c ? [c] : []), ...locks],
            ),
          );
        } else if (pm === "bun" && conventional && pmBin) {
          const c = cfg(["bunfig.toml"]);
          out.push(
            check(env, "test", { id: idAt("test", "bun", cwd), argvTemplate: [pmBin, "test", TESTS], endOfOptions: false, cwd, appliesTo }, [
              manifest,
              ...(c ? [c] : []),
              ...locks,
            ]),
          );
        }
      }
      return out;
    },
  };
}

/* ---- Python -------------------------------------------------------------------------------------------------- */

const PY_MANIFESTS = ["pyproject.toml", "setup.cfg", "setup.py", "requirements.txt", "requirements-dev.txt"] as const;
const PY_LOCKS = ["poetry.lock", "uv.lock", "Pipfile.lock"] as const;
/** pytest file names. */
export const PY_TEST_RE = /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/;

function pyChecks(env: DetectEnv): GateDetector {
  return {
    id: "gates.py-check@1",
    detect(input) {
      const out: GateSpec[] = [];
      for (const [cwd] of byManifest(input, PY_MANIFESTS, /\.pyi?$/)) {
        const pyproject = input.readConfig(join(cwd, "pyproject.toml"));
        const setupCfg = input.readConfig(join(cwd, "setup.cfg"));
        const locks = lockConfigs(input, cwd, PY_LOCKS);
        const manifests: Config[] = [
          ...(pyproject !== null ? [{ path: join(cwd, "pyproject.toml"), text: pyproject }] : []),
          ...(setupCfg !== null ? [{ path: join(cwd, "setup.cfg"), text: setupCfg }] : []),
        ];
        const tool = (name: string) => repoLocal(env, input, cwd, `.venv/bin/${name}`) ?? onPath(env, input, name);
        const python = repoLocal(env, input, cwd, ".venv/bin/python") ?? onPath(env, input, "python3");
        const appliesTo = ["**/*.py", "**/*.pyi", ...nested(input, PY_MANIFESTS, cwd)];
        const section = (re: RegExp) => (pyproject !== null && re.test(pyproject)) || (setupCfg !== null && re.test(setupCfg));
        // lint: ruff check (the formatter is in detect.ts)
        const ruffToml = nearestConfig(input, cwd, ["ruff.toml", ".ruff.toml"]);
        const ruff = tool("ruff");
        if ((ruffToml || section(/^\[tool\.ruff/m)) && ruff) {
          out.push(
            check(env, "lint", { id: idAt("lint", "ruff", cwd), argvTemplate: [ruff, "check", "--no-fix", FILES], endOfOptions: true, cwd, appliesTo }, [
              ...(ruffToml ? [ruffToml] : []),
              ...manifests,
            ]),
          );
        }
        // typecheck: mypy, else pyright
        const mypyIni = nearestConfig(input, cwd, ["mypy.ini", ".mypy.ini"]);
        const pyrightCfg = nearestConfig(input, cwd, ["pyrightconfig.json"]);
        const pyright = tool("pyright") ?? repoLocal(env, input, cwd, "node_modules/.bin/pyright");
        if ((mypyIni || section(/^\[(?:tool\.)?mypy\]/m)) && python) {
          out.push(
            check(env, "typecheck", { id: idAt("typecheck", "mypy", cwd), argvTemplate: [python, "-m", "mypy", FILES], endOfOptions: true, cwd, appliesTo }, [
              ...(mypyIni ? [mypyIni] : []),
              ...manifests,
              ...locks,
            ]),
          );
        } else if ((pyrightCfg || section(/^\[tool\.pyright\]/m)) && pyright) {
          out.push(
            check(env, "typecheck", { id: idAt("typecheck", "pyright", cwd), argvTemplate: [pyright, FILES], endOfOptions: true, cwd, appliesTo }, [
              ...(pyrightCfg ? [pyrightCfg] : []),
              ...manifests,
              ...locks,
            ]),
          );
        }
        // test:related — pytest when the repo declares it (config section, pytest.ini, conftest.py or a venv pytest)
        const pytestIni = nearestConfig(input, cwd, ["pytest.ini"]);
        const present = new Set(input.files.map((f) => f.path));
        const declared =
          pytestIni !== null ||
          section(/^\[(?:tool\.pytest\.ini_options|tool:pytest)\]/m) ||
          present.has(join(cwd, "conftest.py")) ||
          repoLocal(env, input, cwd, ".venv/bin/pytest") !== null;
        if (declared && python) {
          out.push(
            check(
              env,
              "test",
              { id: idAt("test", "pytest", cwd), argvTemplate: [python, "-m", "pytest", "-q", "-x", TESTS], endOfOptions: true, cwd, appliesTo },
              [...(pytestIni ? [pytestIni] : []), ...manifests, ...locks],
            ),
          );
        }
      }
      return out;
    },
  };
}

/* ---- Rust ---------------------------------------------------------------------------------------------------- */

function rustChecks(env: DetectEnv): GateDetector {
  return {
    id: "gates.rust-check@1",
    detect(input) {
      const out: GateSpec[] = [];
      const cargo = onPath(env, input, "cargo");
      if (!cargo) return out;
      for (const [cwd] of byManifest(input, ["Cargo.toml"], /\.rs$/)) {
        const manifest = input.readConfig(join(cwd, "Cargo.toml")) ?? "";
        out.push(
          check(
            env,
            "typecheck",
            {
              id: idAt("typecheck", "cargo-check", cwd),
              argvTemplate: [cargo, "check", "--offline", "--quiet", "--message-format=short"],
              endOfOptions: false,
              cwd,
              appliesTo: ["**/*.rs", ...nested(input, ["Cargo.toml"], cwd)],
            },
            [{ path: join(cwd, "Cargo.toml"), text: manifest }, ...lockConfigs(input, cwd, ["Cargo.lock"])],
          ),
        );
      }
      return out;
    },
  };
}

/** The four check detectors (`gates.go-check@1`, `gates.js-check@1`, `gates.py-check@1`, `gates.rust-check@1`). */
export function checkDetectors(env: DetectEnv): GateDetector[] {
  return [goChecks(env), jsChecks(env), pyChecks(env), rustChecks(env)];
}

/** Config names the check detectors read (added to `configCandidates`). */
export const CHECK_CONFIG_NAMES: readonly string[] = [
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
  "jest.config.json",
  "bunfig.toml",
  "mypy.ini",
  ".mypy.ini",
  "pyrightconfig.json",
  "pytest.ini",
];

/**
 * Related test files of `changed` that exist (`exists(path)`), relative to the repository: a changed test file itself,
 * then the conventional neighbours — `<stem>.test.<ext>` / `.spec.` / `__tests__/` and `<cwd>/test(s)/` for JS/TS,
 * `test_<stem>.py` / `<stem>_test.py` beside it and under `<cwd>/tests/` for Python.
 */
export function relatedTests(cwd: string, changed: readonly RepoPath[], exists: (p: RepoPath) => boolean): RepoPath[] {
  const out = new Set<RepoPath>();
  const roots = cwd === "" ? ["test", "tests"] : [`${cwd}/test`, `${cwd}/tests`];
  for (const p of changed) {
    if (JS_TEST_RE.test(p) || PY_TEST_RE.test(p)) {
      if (exists(p)) out.add(p);
      continue;
    }
    const dir = dirOf(p);
    const name = p.slice(p.lastIndexOf("/") + 1);
    const js = /^(.*)\.([cm]?[jt]sx?)$/.exec(name);
    if (js) {
      const [, stem, ext] = js as unknown as [string, string, string];
      const exts = [...new Set([ext, "ts", "tsx", "js", "jsx"])];
      const cands = exts.flatMap((e) => [
        join(dir, `${stem}.test.${e}`),
        join(dir, `${stem}.spec.${e}`),
        join(dir, `__tests__/${stem}.test.${e}`),
        join(dir, `__tests__/${stem}.${e}`),
        ...roots.map((r) => `${r}/${stem}.test.${e}`),
      ]);
      for (const c of cands) if (c !== p && exists(c)) out.add(c);
      continue;
    }
    const py = /^(.*)\.py$/.exec(name);
    if (py) {
      const stem = py[1] as string;
      const cands = [
        join(dir, `test_${stem}.py`),
        join(dir, `${stem}_test.py`),
        join(dir, `tests/test_${stem}.py`),
        ...roots.map((r) => `${r}/test_${stem}.py`),
      ];
      for (const c of cands) if (exists(c)) out.add(c);
    }
  }
  return [...out].sort();
}

/**
 * Every detected gate for `changed` — format (detect.ts) and the checks here — with repo-declared gates of the same id
 * winning (spec §7.6.1). Sorted by id; the runner orders by kind.
 */
export function detectGates(env: DetectEnv, input: DetectInput, declared: readonly GateSpec[] = []): GateSpec[] {
  const out = new Map<string, GateSpec>();
  for (const s of detectFormatGates(env, input)) out.set(s.id, s);
  for (const d of checkDetectors(env)) for (const s of d.detect(input)) out.set(s.id, s);
  for (const s of declared) out.set(s.id, s);
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Config paths every detector may read for `changed` (format + check names, each ancestor directory). */
export function gateConfigCandidates(changed: readonly RepoPath[]): RepoPath[] {
  const out = new Set<RepoPath>(configCandidates(changed));
  for (const p of changed) for (const d of ancestors(dirOf(p))) for (const n of CHECK_CONFIG_NAMES) out.add(join(d, n));
  return [...out].sort();
}
