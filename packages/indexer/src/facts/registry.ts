/**
 * Tier-1 fact detectors (spec §5.2 改訂 R1 SC-26). The parse Worker (WP-02) runs `extract` for every id in
 * `ParseItem.detectors` (= `detectorsFor(file)`) while the tree is alive; `facts/stage.ts` links on the main thread.
 * Detectors are added only together with their truth (R1).
 */
import type { FactKind } from "@mitori/core";
import { ENV_TEMPLATE_GLOBS } from "@mitori/core";
import picomatch from "picomatch";
import type { FactCandidate, FactDetector, FactExtractInput, GrammarId } from "../contract.ts";
import { baseOf } from "../resolve/files.ts";
import { goCobra, goEntry, goEnv, goRegistry, goRoutes, goTestMain, goTests } from "./go.ts";
import { jsCommander, jsEnv, jsRegistry, jsRoutes, jsTests } from "./js.ts";
import { linkByDetector } from "./link.ts";
import { pyClick, pyEntry, pyEnv, pyRoutes, pyTests } from "./py.ts";
import { rustClap, rustEntry, rustEnv, rustTests } from "./rust.ts";
import {
  cargoManifest,
  compose,
  denoTasks,
  dockerfile,
  envTemplate,
  existingDoc,
  flakeNix,
  goMod,
  justfile,
  makefile,
  npmManifest,
  procfile,
  pyproject,
  requirementsTxt,
  serverless,
  sqlSchema,
  taskfile,
  todos,
  wrangler,
} from "./text.ts";
import { asTree, type Tree } from "./tsq.ts";

type File = FactExtractInput["file"];
type TreeFn = (input: FactExtractInput, tree: Tree) => FactCandidate[];
type TextFn = (input: FactExtractInput) => FactCandidate[];

const JS_LANGS = new Set(["typescript", "tsx", "javascript", "jsx"]);
const isEnvTemplate = picomatch([...ENV_TEMPLATE_GLOBS], { dot: true });
const inVendor = (p: string) => /(^|\/)node_modules\//.test(p);

/** One-entry memo so that the several detectors fed by the same manifest parse it once per file. */
function memoText(fn: TextFn): TextFn {
  let lastPath = "";
  let lastText: string | null = null;
  let last: FactCandidate[] = [];
  return (input) => {
    if (input.file.path !== lastPath || input.text !== lastText) {
      lastPath = input.file.path;
      lastText = input.text;
      last = fn(input);
    }
    return last;
  };
}

const MANIFESTS: { test: (f: File) => boolean; fn: TextFn; ids: readonly string[] }[] = [
  { test: (f) => baseOf(f.path) === "package.json" && !inVendor(f.path), fn: memoText(npmManifest), ids: ["entry.node@1", "script.npm@1", "dep.npm@1"] },
  { test: (f) => /^deno\.jsonc?$/.test(baseOf(f.path)), fn: denoTasks, ids: ["script.deno@1"] },
  { test: (f) => baseOf(f.path) === "go.mod", fn: goMod, ids: ["dep.go@1"] },
  { test: (f) => baseOf(f.path) === "pyproject.toml", fn: memoText(pyproject), ids: ["dep.py@1", "entry.python@1", "script.py@1"] },
  { test: (f) => /^requirements[^/]*\.txt$/.test(baseOf(f.path)), fn: requirementsTxt, ids: ["dep.py@1"] },
  { test: (f) => baseOf(f.path) === "Cargo.toml", fn: cargoManifest, ids: ["dep.cargo@1"] },
  { test: (f) => /^(Makefile|makefile|GNUmakefile)$|\.mk$/.test(baseOf(f.path)), fn: makefile, ids: ["script.make@1"] },
  { test: (f) => /^(justfile|Justfile|\.justfile)$/.test(baseOf(f.path)), fn: justfile, ids: ["script.just@1"] },
  { test: (f) => /^Taskfile\.ya?ml$/.test(baseOf(f.path)), fn: taskfile, ids: ["script.task@1"] },
  { test: (f) => baseOf(f.path) === "flake.nix", fn: flakeNix, ids: ["script.nix@1"] },
  { test: (f) => /^Dockerfile|\.dockerfile$/.test(baseOf(f.path)), fn: memoText(dockerfile), ids: ["entry.deploy@1", "env.files@1"] },
  { test: (f) => baseOf(f.path) === "Procfile", fn: procfile, ids: ["entry.deploy@1"] },
  { test: (f) => /^wrangler\.(toml|jsonc?)$/.test(baseOf(f.path)), fn: memoText(wrangler), ids: ["entry.deploy@1", "env.files@1"] },
  { test: (f) => /^serverless\.ya?ml$/.test(baseOf(f.path)), fn: serverless, ids: ["entry.deploy@1"] },
  { test: (f) => /^(docker-compose[^/]*|compose)\.ya?ml$/.test(baseOf(f.path)), fn: compose, ids: ["env.files@1"] },
  { test: (f) => isEnvTemplate(f.path), fn: envTemplate, ids: ["env.files@1"] },
  { test: (f) => /\.sql$/i.test(f.path), fn: sqlSchema, ids: ["schema.sql@1"] },
];

const fromText =
  (id: string): TextFn =>
  (input) => {
    const out: FactCandidate[] = [];
    for (const m of MANIFESTS) if (m.ids.includes(id) && m.test(input.file)) for (const c of m.fn(input)) if (c.detector === id) out.push(c);
    return out;
  };

const textApplies = (id: string, f: File): boolean => MANIFESTS.some((m) => m.ids.includes(id) && m.test(f));

function detector(id: string, kinds: FactKind[], runsOn: (GrammarId | "text")[], appliesTo: (f: File) => boolean, tree?: TreeFn, text?: TextFn): FactDetector {
  return {
    id,
    kinds,
    runsOn,
    appliesTo,
    extract(input) {
      const t = asTree(input.tree);
      const out: FactCandidate[] = [];
      if (t && tree) out.push(...tree(input, t));
      if (text) out.push(...text(input));
      return out;
    },
    link: (candidates, ctx) => linkByDetector(id, candidates, ctx),
  };
}

const lang =
  (...langs: string[]) =>
  (f: File) =>
    langs.includes(f.lang);
const js = (f: File) => JS_LANGS.has(f.lang);
const GO: GrammarId[] = ["go"];
const JS: GrammarId[] = ["typescript", "tsx", "javascript"];

export const FACT_DETECTORS: readonly FactDetector[] = [
  detector("entry.go@1", ["entry"], GO, lang("go"), goEntry),
  detector("entry.testmain@1", ["entry"], GO, lang("go"), goTestMain),
  detector("entry.node@1", ["entry"], ["text"], (f) => textApplies("entry.node@1", f), undefined, fromText("entry.node@1")),
  detector(
    "entry.python@1",
    ["entry"],
    ["python", "text"],
    (f) => f.lang === "python" || textApplies("entry.python@1", f),
    pyEntry,
    fromText("entry.python@1"),
  ),
  detector("entry.rust@1", ["entry"], ["rust"], lang("rust"), rustEntry),
  detector("entry.deploy@1", ["entry"], ["text"], (f) => textApplies("entry.deploy@1", f), undefined, fromText("entry.deploy@1")),
  detector("route.nethttp@1", ["route"], GO, lang("go"), goRoutes),
  detector("route.hono@1", ["route"], JS, js, (i, t) => jsRoutes(i, t, "hono")),
  detector("route.express@1", ["route"], JS, js, (i, t) => jsRoutes(i, t, "express")),
  detector("route.fastapi@1", ["route"], ["python"], lang("python"), (i, t) => pyRoutes(i, t, "fastapi")),
  detector("route.flask@1", ["route"], ["python"], lang("python"), (i, t) => pyRoutes(i, t, "flask")),
  detector(
    "cli.registry@1",
    ["cli"],
    [...GO, ...JS],
    (f) => f.lang === "go" || js(f),
    (i, t) => (i.file.lang === "go" ? goRegistry(i, t) : jsRegistry(i, t)),
  ),
  detector("cli.cobra@1", ["cli"], GO, lang("go"), goCobra),
  detector("cli.click@1", ["cli"], ["python"], lang("python"), pyClick),
  detector("cli.clap@1", ["cli"], ["rust"], lang("rust"), rustClap),
  detector("cli.commander@1", ["cli"], JS, js, jsCommander),
  detector("env.js@1", ["env"], JS, js, jsEnv),
  detector("env.python@1", ["env"], ["python"], lang("python"), pyEnv),
  detector("env.go@1", ["env"], GO, lang("go"), goEnv),
  detector("env.rust@1", ["env"], ["rust"], lang("rust"), rustEnv),
  detector("env.files@1", ["env"], ["text"], (f) => textApplies("env.files@1", f), undefined, fromText("env.files@1")),
  ...(["script.npm@1", "script.make@1", "script.just@1", "script.nix@1", "script.deno@1", "script.py@1", "script.task@1"] as const).map((id) =>
    detector(id, ["script"], ["text"], (f) => textApplies(id, f), undefined, fromText(id)),
  ),
  ...(["dep.npm@1", "dep.go@1", "dep.py@1", "dep.cargo@1"] as const).map((id) =>
    detector(id, ["dependency"], ["text"], (f) => textApplies(id, f), undefined, fromText(id)),
  ),
  detector("schema.sql@1", ["schema"], ["text"], (f) => textApplies("schema.sql@1", f), undefined, fromText("schema.sql@1")),
  detector("doc.existing@1", ["existing_doc"], ["text"], (f) => f.class === "docs", undefined, existingDoc),
  detector(
    "todo.comment@1",
    ["todo"],
    ["typescript", "tsx", "javascript", "python", "go", "rust", "text"],
    (f) => f.class === "source" || f.class === "test" || f.class === "docs" || f.class === "config",
    (input, t) => (TODO_WORD.test(input.text) ? todos(input, (i) => /comment/.test(t.rootNode.descendantForIndex(i)?.type ?? "")) : []),
    (input) => (asTree(input.tree) || !TODO_WORD.test(input.text) ? [] : todos(input)),
  ),
  detector("test.go@1", ["test"], GO, lang("go"), goTests),
  detector("test.js@1", ["test"], JS, js, jsTests),
  detector("test.python@1", ["test"], ["python"], lang("python"), pyTests),
  detector("test.rust@1", ["test"], ["rust"], lang("rust"), rustTests),
];

const TODO_WORD = /\b(TODO|FIXME|HACK|XXX)\b/;

const BY_ID = new Map(FACT_DETECTORS.map((d) => [d.id, d]));

export function detectorById(id: string): FactDetector | undefined {
  return BY_ID.get(id);
}

/** Detector ids applicable to a file (`ParseItem.detectors`). */
export function detectorsFor(file: File): string[] {
  return FACT_DETECTORS.filter((d) => d.appliesTo(file)).map((d) => d.id);
}

/** Candidates of one file: run every applicable detector (what the Worker does per item). */
export function extractFacts(input: FactExtractInput, ids: readonly string[] = detectorsFor(input.file)): FactCandidate[] {
  const out: FactCandidate[] = [];
  for (const id of ids) out.push(...(BY_ID.get(id)?.extract(input) ?? []));
  return out;
}

/** Detector set version (`idx_fact_cands.detectors` key part): the sorted ids joined (hashed by the caller). */
export const DETECTOR_SET = FACT_DETECTORS.map((d) => d.id)
  .sort()
  .join(",");
