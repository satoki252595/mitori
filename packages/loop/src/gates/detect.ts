// Format-gate detection (spec §7.6.1, the `format` column; typecheck / test detectors are WP-08c). Nothing is
// executed: the nearest manifest directory of each changed file becomes the gate `cwd`, binaries are repo-local
// (`node_modules/.bin`, `.venv/bin`) or language toolchains on SAFE_PATH — never a download path (npx, bunx, dlx).
// `executesRepoCode` is false only for the pure-formatter allowlist of ADR-0013 (gofmt, cargo fmt, ruff format,
// black, biome with a JSON config); prettier loads JS configs and plugins, so it always counts as repo code.
import { canonicalJson, type GateArg, type GateSpec, type Hasher, type RepoPath } from "@mitori/core";
import { GATE_TIMEOUTS, type GateDetector } from "../contract.ts";

/** Input of every detector (the contract's `GateDetector.detect` input). */
export type DetectInput = Parameters<GateDetector["detect"]>[0];

const FILES: GateArg = { var: "files" };

const dirOf = (p: RepoPath): string => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};
const join = (dir: string, name: string): RepoPath => (dir === "" ? name : `${dir}/${name}`);

/** Ancestors of a directory, nearest first, ending with the root `""`. */
function ancestors(dir: string): string[] {
  const out: string[] = [];
  let d = dir;
  for (;;) {
    out.push(d);
    if (d === "") return out;
    d = dirOf(d);
  }
}

/** Groups changed files by the nearest directory containing one of `manifests`. */
function byManifest(input: DetectInput, manifests: readonly string[], exts: RegExp): Map<string, RepoPath[]> {
  const present = new Set(input.files.map((f) => f.path));
  const out = new Map<string, RepoPath[]>();
  for (const path of input.changed) {
    if (!exts.test(path)) continue;
    const dir = ancestors(dirOf(path)).find((d) => manifests.some((m) => present.has(join(d, m)) || input.readConfig(join(d, m)) !== null));
    if (dir === undefined) continue;
    out.set(dir, [...(out.get(dir) ?? []), path]);
  }
  return out;
}

/** `!<dir>/**` for every manifest directory strictly below `cwd` (those files belong to their own gate). */
function nested(input: DetectInput, manifests: readonly string[], cwd: string): string[] {
  const dirs = new Set<string>();
  for (const f of input.files) {
    const name = f.path.slice(f.path.lastIndexOf("/") + 1);
    if (!manifests.includes(name)) continue;
    const d = dirOf(f.path);
    if (d !== cwd && (cwd === "" || d.startsWith(`${cwd}/`))) dirs.add(d);
  }
  return [...dirs].sort().map((d) => `!${d}/**`);
}

/** First config file of `names` found in `dir` or its ancestors (text + path). */
function nearestConfig(input: DetectInput, dir: string, names: readonly string[]): { path: RepoPath; text: string } | null {
  for (const d of ancestors(dir)) {
    for (const n of names) {
      const path = join(d, n);
      const text = input.readConfig(path);
      if (text !== null) return { path, text };
    }
  }
  return null;
}

/** Ports of the detectors: `PATH` directories (SAFE_PATH) and the absolute repository root. */
export interface DetectEnv {
  /** SAFE_PATH entries. */
  pathDirs: readonly string[];
  /** Absolute repository root (repo-local binaries are checked there). */
  root: string;
  /** Hashing (trust hashes). */
  hasher: Pick<Hasher, "sha256">;
}

/** A tool on SAFE_PATH: the bare name (resolved by the spawner at run time, so a toolchain update keeps trust). */
function onPath(env: DetectEnv, input: DetectInput, name: string): string | null {
  return env.pathDirs.some((d) => d !== "" && input.binaryExists(`${d}/${name}`)) ? name : null;
}

/** A repo-local binary under `dir` or the root: its repo-relative path. */
function repoLocal(env: DetectEnv, input: DetectInput, dir: string, rel: string): RepoPath | null {
  for (const d of [dir, ""]) {
    const p = join(d, rel);
    if (input.binaryExists(`${env.root}/${p}`)) return p;
  }
  return null;
}

/** Trust hash: canonical gate fields + the config texts the detection read (CONS-12). */
export function gateTrustHash(hasher: Pick<Hasher, "sha256">, spec: Omit<GateSpec, "trustHash">, configs: readonly { path: RepoPath; text: string }[]): string {
  const canon = canonicalJson({
    id: spec.id,
    kind: spec.kind,
    argvTemplate: spec.argvTemplate,
    endOfOptions: spec.endOfOptions,
    cwd: spec.cwd,
    appliesTo: spec.appliesTo,
    autofix: spec.autofix,
    executesRepoCode: spec.executesRepoCode,
  });
  const cfg = [...configs].sort((a, b) => (a.path < b.path ? -1 : 1)).map((c) => `${c.path}\0${c.text}\0`);
  return hasher.sha256(`mitori.gates/1\n${canon}\n${cfg.join("")}`);
}

function spec(
  env: DetectEnv,
  f: Omit<GateSpec, "trustHash" | "kind" | "autofix" | "timeoutMs" | "source">,
  configs: { path: RepoPath; text: string }[],
): GateSpec {
  const base: Omit<GateSpec, "trustHash"> = { ...f, kind: "format", autofix: true, timeoutMs: GATE_TIMEOUTS.format, source: "detected" };
  return { ...base, trustHash: gateTrustHash(env.hasher, base, configs) };
}

const idAt = (name: string, cwd: string) => (cwd === "" ? `fmt:${name}` : `fmt:${name}@${cwd}`) as GateSpec["id"];

function goDetector(env: DetectEnv): GateDetector {
  return {
    id: "gates.go@1",
    detect(input) {
      const out: GateSpec[] = [];
      const gofmt = onPath(env, input, "gofmt");
      if (!gofmt) return out;
      for (const [cwd] of byManifest(input, ["go.mod"], /\.go$/)) {
        const mod = input.readConfig(join(cwd, "go.mod")) ?? "";
        out.push(
          spec(
            env,
            {
              id: idAt("gofmt", cwd),
              argvTemplate: [gofmt, "-w", FILES],
              endOfOptions: true,
              cwd,
              appliesTo: ["**/*.go", ...nested(input, ["go.mod"], cwd)],
              executesRepoCode: false,
            },
            [{ path: join(cwd, "go.mod"), text: mod }],
          ),
        );
      }
      return out;
    },
  };
}

const BIOME_CONFIGS = ["biome.json", "biome.jsonc"] as const;
const PRETTIER_CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.json5",
  ".prettierrc.toml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
] as const;

function jsDetector(env: DetectEnv): GateDetector {
  return {
    id: "gates.js@1",
    detect(input) {
      const out: GateSpec[] = [];
      for (const [cwd] of byManifest(input, ["package.json"], /\.(?:[cm]?[jt]sx?|json|jsonc|css|scss|less|md|html|vue|svelte|ya?ml)$/)) {
        const pkg = input.readConfig(join(cwd, "package.json")) ?? "";
        const biomeCfg = nearestConfig(input, cwd, BIOME_CONFIGS);
        const biome = repoLocal(env, input, cwd, "node_modules/.bin/biome");
        if (biomeCfg && biome) {
          out.push(
            spec(
              env,
              {
                id: idAt("biome", cwd),
                argvTemplate: [biome, "format", "--write", FILES],
                endOfOptions: false,
                cwd,
                appliesTo: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,json,jsonc,css}", ...nested(input, ["package.json"], cwd)],
                executesRepoCode: false,
              },
              [biomeCfg, { path: join(cwd, "package.json"), text: pkg }],
            ),
          );
          continue;
        }
        const prettierCfg = nearestConfig(input, cwd, PRETTIER_CONFIGS);
        const devDep = /"prettier"\s*:/.test(pkg);
        const prettier = repoLocal(env, input, cwd, "node_modules/.bin/prettier");
        if ((prettierCfg || devDep) && prettier) {
          out.push(
            spec(
              env,
              {
                id: idAt("prettier", cwd),
                argvTemplate: [prettier, "--write", FILES],
                endOfOptions: true,
                cwd,
                appliesTo: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,json,css,scss,less,md,html,vue,svelte,yml,yaml}", ...nested(input, ["package.json"], cwd)],
                executesRepoCode: true,
              },
              [...(prettierCfg ? [prettierCfg] : []), { path: join(cwd, "package.json"), text: pkg }],
            ),
          );
        }
      }
      return out;
    },
  };
}

const PY_MANIFESTS = ["pyproject.toml", "setup.cfg", "setup.py", "requirements.txt", "requirements-dev.txt"] as const;

function pyDetector(env: DetectEnv): GateDetector {
  return {
    id: "gates.py@1",
    detect(input) {
      const out: GateSpec[] = [];
      for (const [cwd] of byManifest(input, PY_MANIFESTS, /\.pyi?$/)) {
        const pyproject = input.readConfig(join(cwd, "pyproject.toml"));
        const ruffToml = nearestConfig(input, cwd, ["ruff.toml", ".ruff.toml"]);
        const tool = (name: string) => repoLocal(env, input, cwd, `.venv/bin/${name}`) ?? onPath(env, input, name);
        const ruff = tool("ruff");
        if ((ruffToml || (pyproject !== null && /^\[tool\.ruff/m.test(pyproject))) && ruff) {
          const configs = [...(ruffToml ? [ruffToml] : []), ...(pyproject !== null ? [{ path: join(cwd, "pyproject.toml"), text: pyproject }] : [])];
          out.push(
            spec(
              env,
              {
                id: idAt("ruff", cwd),
                argvTemplate: [ruff, "format", FILES],
                endOfOptions: true,
                cwd,
                appliesTo: ["**/*.py", "**/*.pyi", ...nested(input, PY_MANIFESTS, cwd)],
                executesRepoCode: false,
              },
              configs,
            ),
          );
          continue;
        }
        const black = tool("black");
        if (pyproject !== null && /^\[tool\.black\]/m.test(pyproject) && black) {
          out.push(
            spec(
              env,
              {
                id: idAt("black", cwd),
                argvTemplate: [black, "-q", FILES],
                endOfOptions: true,
                cwd,
                appliesTo: ["**/*.py", "**/*.pyi", ...nested(input, PY_MANIFESTS, cwd)],
                executesRepoCode: false,
              },
              [{ path: join(cwd, "pyproject.toml"), text: pyproject }],
            ),
          );
        }
      }
      return out;
    },
  };
}

function rustDetector(env: DetectEnv): GateDetector {
  return {
    id: "gates.rust@1",
    detect(input) {
      const out: GateSpec[] = [];
      const cargo = onPath(env, input, "cargo");
      if (!cargo || !onPath(env, input, "rustfmt")) return out;
      for (const [cwd] of byManifest(input, ["Cargo.toml"], /\.rs$/)) {
        const manifest = input.readConfig(join(cwd, "Cargo.toml")) ?? "";
        const fmtCfg = nearestConfig(input, cwd, ["rustfmt.toml", ".rustfmt.toml"]);
        out.push(
          spec(
            env,
            {
              id: idAt("cargo-fmt", cwd),
              argvTemplate: [cargo, "fmt", "--", FILES],
              endOfOptions: false,
              cwd,
              appliesTo: ["**/*.rs", ...nested(input, ["Cargo.toml"], cwd)],
              executesRepoCode: false,
            },
            [{ path: join(cwd, "Cargo.toml"), text: manifest }, ...(fmtCfg ? [fmtCfg] : [])],
          ),
        );
      }
      return out;
    },
  };
}

/** The four format detectors (`gates.js@1`, `gates.go@1`, `gates.py@1`, `gates.rust@1`). */
export function formatDetectors(env: DetectEnv): GateDetector[] {
  return [jsDetector(env), goDetector(env), pyDetector(env), rustDetector(env)];
}

/** Every detected format gate for `changed`, repo-declared gates of the same id winning (spec §7.6.1). */
export function detectFormatGates(env: DetectEnv, input: DetectInput, declared: readonly GateSpec[] = []): GateSpec[] {
  const out = new Map<string, GateSpec>();
  for (const d of formatDetectors(env)) for (const s of d.detect(input)) out.set(s.id, s);
  for (const s of declared) if (s.kind === "format") out.set(s.id, s);
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Files a gate's runtime needs next to the changed files when it runs on temp copies (ADR-0006 R1-6): the config
 * files of the gate cwd and its ancestors, and for cargo the crate's manifest and Rust sources.
 */
export function supportFiles(gate: GateSpec, paths: readonly RepoPath[]): RepoPath[] {
  const present = new Set(paths);
  const out = new Set<RepoPath>();
  for (const d of ancestors(gate.cwd)) for (const n of CONFIG_NAMES) if (present.has(join(d, n))) out.add(join(d, n));
  if (gate.id.startsWith("fmt:cargo-fmt")) {
    const prefix = gate.cwd === "" ? "" : `${gate.cwd}/`;
    for (const p of paths) if (p.startsWith(prefix) && p.endsWith(".rs")) out.add(p);
  }
  return [...out].sort();
}

/** Every config / manifest name a format detector or formatter reads. */
export const CONFIG_NAMES: readonly string[] = [
  "go.mod",
  "package.json",
  ...BIOME_CONFIGS,
  ...PRETTIER_CONFIGS,
  ".editorconfig",
  ...PY_MANIFESTS,
  "ruff.toml",
  ".ruff.toml",
  "Cargo.toml",
  "Cargo.lock",
  "rustfmt.toml",
  ".rustfmt.toml",
];

/** Config paths detection may read for `changed` (each ancestor directory × {@link CONFIG_NAMES}). */
export function configCandidates(changed: readonly RepoPath[]): RepoPath[] {
  const out = new Set<RepoPath>();
  for (const p of changed) for (const d of ancestors(dirOf(p))) for (const n of CONFIG_NAMES) out.add(join(d, n));
  return [...out].sort();
}
