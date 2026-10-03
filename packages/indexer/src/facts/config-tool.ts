/** Configuration file → `{tool, role}` by basename and path (spec §5.5 `ConfigEntry`, core `ConfigFact` CR idx-4). */
import type { RepoPath } from "@mitori/core";
import type { ConfigRole, ConfigTool } from "../contract.ts";
import { baseOf } from "../resolve/files.ts";

const RULES: [RegExp, ConfigTool, ConfigRole][] = [
  [/^package\.json$/, "npm", "deps"],
  [/^(tsconfig[^/]*|jsconfig)\.json$/, "tsconfig", "typecheck"],
  [/^deno\.jsonc?$/, "deno", "runtime"],
  [/^bunfig\.toml$/, "bun", "runtime"],
  [/^biome\.jsonc?$/, "biome", "lint"],
  [/^(\.eslintrc.*|eslint\.config\.[cm]?[jt]s)$/, "eslint", "lint"],
  [/^(\.prettierrc.*|prettier\.config\.[cm]?[jt]s)$/, "prettier", "format"],
  [/^vitest\.config\./, "vitest", "test"],
  [/^vite\.config\./, "vite", "build"],
  [/^jest\.config\./, "jest", "test"],
  [/^webpack\.config\./, "webpack", "build"],
  [/^rollup\.config\./, "rollup", "build"],
  [/^(babel\.config\.|\.babelrc)/, "babel", "build"],
  [/^next\.config\./, "next", "build"],
  [/^nuxt\.config\./, "nuxt", "build"],
  [/^svelte\.config\./, "svelte", "build"],
  [/^astro\.config\./, "astro", "build"],
  [/^tailwind\.config\./, "tailwind", "build"],
  [/^postcss\.config\./, "postcss", "build"],
  [/^wrangler\.(toml|jsonc?)$/, "wrangler", "deploy"],
  [/^vercel\.json$/, "vercel", "deploy"],
  [/^netlify\.toml$/, "netlify", "deploy"],
  [/^(Dockerfile.*|.*\.dockerfile)$/, "docker", "deploy"],
  [/^(docker-compose.*|compose)\.ya?ml$/, "compose", "deploy"],
  [/^(Makefile|makefile|GNUmakefile|.*\.mk)$/, "make", "build"],
  [/^(justfile|Justfile|\.justfile)$/, "just", "build"],
  [/^Taskfile\.ya?ml$/, "task", "build"],
  [/^(flake|default|shell)\.nix$/, "nix", "build"],
  [/^pyproject\.toml$/, "pyproject", "deps"],
  [/^setup\.(cfg|py)$/, "setuptools", "build"],
  [/^tox\.ini$/, "tox", "test"],
  [/^pytest\.ini$/, "pytest", "test"],
  [/^mypy\.ini$/, "mypy", "typecheck"],
  [/^\.?ruff\.toml$/, "ruff", "lint"],
  [/^\.flake8$/, "flake8", "lint"],
  [/^requirements[^/]*\.txt$/, "pip", "deps"],
  [/^Pipfile$/, "pipenv", "deps"],
  [/^environment\.ya?ml$/, "conda", "deps"],
  [/^go\.mod$/, "gomod", "deps"],
  [/^go\.work$/, "gowork", "deps"],
  [/^Cargo\.toml$/, "cargo", "deps"],
  [/^rust-toolchain(\.toml)?$/, "rust-toolchain", "runtime"],
  [/^(Gemfile|.*\.gemspec)$/, "gemfile", "deps"],
  [/^pom\.xml$/, "maven", "build"],
  [/^(build|settings)\.gradle(\.kts)?$/, "gradle", "build"],
  [/^\.git(ignore|attributes)$/, "git", "other"],
  [/^\.editorconfig$/, "editor", "editor"],
  [/^(\.nvmrc|\.node-version|\.tool-versions|\.python-version|mise\.toml|\.mise\.toml)$/, "version-pin", "runtime"],
  [/^\.gitlab-ci\.yml$/, "ci", "ci"],
  [/\.config\.[cm]?[jt]s$/, "other", "build"],
];

export function configToolOf(path: RepoPath): { tool: ConfigTool; role: ConfigRole } {
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path) || /(^|\/)\.circleci\//.test(path)) return { tool: "ci", role: "ci" };
  const b = baseOf(path);
  for (const [re, tool, role] of RULES) if (re.test(b)) return { tool, role };
  return { tool: "other", role: "other" };
}
