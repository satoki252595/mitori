// Language detection (indexer spec §2.4): extension (compound first) → shebang → special names → generic.
// Flow-annotated js/jsx switch to the tsx grammar (IDX-D5) without changing `lang`.
import type { SourceLang } from "@mitori/core";
import { type GrammarId, INVENTORY_LIMITS, LANG_GRAMMAR } from "../contract.ts";

/** Extension table, longest suffix first. */
const EXT_LANG: readonly (readonly [suffix: string, lang: SourceLang, decl?: true])[] = [
  [".d.ts", "typescript", true],
  [".d.mts", "typescript", true],
  [".d.cts", "typescript", true],
  [".ts", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".tsx", "tsx"],
  [".jsx", "jsx"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".py", "python"],
  [".pyi", "python"],
  [".pyw", "python"],
  [".go", "go"],
  [".rs", "rust"],
];

/** Basenames that are always generic (build files with their own syntax). */
const SPECIAL_NAMES: ReadonlySet<string> = new Set([
  "Dockerfile",
  "Makefile",
  "Justfile",
  "justfile",
  "Procfile",
  "BUILD",
  "WORKSPACE",
  "Jenkinsfile",
  "Vagrantfile",
  "Gemfile",
  "Rakefile",
]);

/** Display dialects for generic files (linguist-like names, `idx_files.dialect`). */
const DIALECTS: Readonly<Record<string, string>> = {
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  scala: "scala",
  lua: "lua",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  sql: "sql",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  clj: "clojure",
  cljs: "clojure",
  dart: "dart",
  r: "r",
  jl: "julia",
  m: "objective-c",
  mm: "objective-c",
  zig: "zig",
  nim: "nim",
  sol: "solidity",
  tf: "hcl",
  hcl: "hcl",
  proto: "protobuf",
  graphql: "graphql",
  gql: "graphql",
  prisma: "prisma",
  el: "elisp",
  vim: "vim",
  groovy: "groovy",
  pl: "perl",
  pm: "perl",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  rst: "rst",
  adoc: "asciidoc",
  asciidoc: "asciidoc",
  json: "json",
  jsonc: "json",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  nix: "nix",
  xml: "xml",
  txt: "text",
};

/** Basename of a repo path. */
export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** Lower-cased last extension without the dot (`""` when none; dotfiles like `.env` have none). */
export function extOf(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i + 1).toLowerCase();
}

/** Language by path only (extension / special names). `decl` marks `.d.ts`-style declaration files. */
export function langOfPath(path: string): { lang: SourceLang; decl: boolean } {
  const b = basename(path);
  if (SPECIAL_NAMES.has(b)) return { lang: "generic", decl: false };
  const lower = b.toLowerCase();
  for (const [suffix, lang, decl] of EXT_LANG) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) return { lang, decl: decl === true };
  }
  return { lang: "generic", decl: false };
}

/** True when the path's language can only be decided from content (no extension, not a special name). */
export function needsShebang(path: string): boolean {
  const b = basename(path);
  return extOf(path) === "" && !SPECIAL_NAMES.has(b);
}

/** Language from a `#!` first line (spec §2.4-2), null when not a shebang or not a plugin language. */
export function shebangLang(firstLine: string): SourceLang | null {
  if (!firstLine.startsWith("#!")) return null;
  if (/\b(deno|tsx|ts-node)\b/.test(firstLine)) return "typescript";
  if (/\b(node|bun)\b/.test(firstLine)) return "javascript";
  if (/\bpython[0-9.]*\b/.test(firstLine)) return "python";
  return null;
}

/** IDX-D5: `@flow` in the first 2 KiB of a js/jsx file. */
export function hasFlowPragma(text: string): boolean {
  return /@flow\b/.test(text.length > INVENTORY_LIMITS.flowSniffBytes ? text.slice(0, INVENTORY_LIMITS.flowSniffBytes) : text);
}

/** Grammar actually used for a file (`tsx` for Flow js/jsx). */
export function grammarFor(lang: SourceLang, text?: string): GrammarId | null {
  const g = LANG_GRAMMAR[lang];
  if (g === "javascript" && text !== undefined && hasFlowPragma(text)) return "tsx";
  return g;
}

/** Display dialect of a generic file (null for plugin languages). */
export function dialectOf(path: string, lang: SourceLang): string | null {
  if (lang !== "generic") return null;
  const b = basename(path);
  if (SPECIAL_NAMES.has(b)) return b.toLowerCase();
  return DIALECTS[extOf(path)] ?? null;
}
