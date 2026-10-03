// Locations and the `mitori.fixture/1` descriptor (testing spec §2.2). Internal to testkit.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MitoriError } from "@mitori/core";
import { type FixtureName, TEST_FORMATS } from "../contract.ts";

/** The workspace root (the directory that contains `fixtures/`). `import.meta.url`, not Bun's `import.meta.dir`: Playwright loads testkit under Node. */
export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

/** `gen:palette-50k` → `gen-palette-50k` (file-system safe). */
export const safeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, "-");

export const fixtureDir = (name: FixtureName): string => join(REPO_ROOT, "fixtures/repos", safeName(name));
export const truthFile = (name: FixtureName): string => join(REPO_ROOT, "fixtures/truth", `${safeName(name)}.json`);
export const commitsFile = (name: FixtureName): string => join(REPO_ROOT, "fixtures/golden", safeName(name), "commits.json");

export interface GenerateSpec {
  /** Repo-relative output path. */
  path: string;
  /** Registered generator id (see generators.ts). */
  generator: string;
  /** Exact output size in bytes (generators that take one). */
  bytes?: number;
  /** PRNG seed (default 1). */
  seed?: number;
  /** Verbatim content for the `text` generator (use it for CRLF, odd file names that git would normalise, ...). */
  text?: string;
  /** Lower-case hex of the exact bytes for the `hex` generator (BOM, invalid UTF-8, a PNG ...). */
  hex?: string;
}

export interface SymlinkSpec {
  /** Link path (repo-relative). */
  path: string;
  /** Link target exactly as stored (may point outside the repo or at itself). */
  target: string;
  /** True (default) = created before the first commit and committed; false = left untracked. */
  tracked?: boolean;
}

export interface DirtySpec {
  /** Informational: the tracked file the patch touches. */
  path?: string;
  /** Patch (relative to the fixture dir) applied to the working tree without committing. */
  patch?: string;
  /** Untracked files to create; content comes from `dirty/untracked/<path>`. */
  untracked?: string[];
}

export interface FixtureSpec {
  v: typeof TEST_FORMATS.fixture;
  name: string;
  git: boolean;
  objectFormat: "sha1" | "sha256";
  branch: string;
  /** Step 0 is the fixture tree itself (`tree: "."`); later steps are patches applied in order. */
  history: { message: string; tree?: string; patch?: string }[];
  generate: GenerateSpec[];
  symlinks: SymlinkSpec[];
  dirty: DirtySpec[];
}

/** Read and validate `fixtures/repos/<name>/fixture.json`. */
export function readSpec(name: FixtureName): FixtureSpec {
  const file = join(fixtureDir(name), "fixture.json");
  if (!existsSync(file)) throw new MitoriError("E_NOT_FOUND", `no fixture "${name}" (${file})`);
  const spec = JSON.parse(readFileSync(file, "utf8")) as FixtureSpec;
  const bad = (why: string): never => {
    throw new MitoriError("E_INVALID_INPUT", `fixture ${name}: ${why}`);
  };
  if (spec.v !== TEST_FORMATS.fixture) bad(`"v" must be ${TEST_FORMATS.fixture}`);
  if (spec.name !== safeName(name)) bad(`"name" must be ${safeName(name)}`);
  if (spec.git && (spec.history.length === 0 || spec.history[0]?.tree !== ".")) bad(`history[0] must be {"tree": "."}`);
  for (const h of spec.history.slice(1)) if (!h.patch) bad(`history step "${h.message}" needs a patch`);
  return { ...spec, generate: spec.generate ?? [], symlinks: spec.symlinks ?? [], dirty: spec.dirty ?? [] };
}
