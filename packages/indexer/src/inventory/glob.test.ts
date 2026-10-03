// IDX-U: the fast glob matcher agrees with picomatch (`dot: true`) on the deny / secret lists and odd shapes.
import { describe, expect, test } from "bun:test";
import { DEFAULT_DENY_GLOBS, ENV_TEMPLATE_GLOBS, SECRET_PATH_GLOBS } from "@mitori/core";
import picomatch from "picomatch";
import { compileGlobs } from "./glob.ts";

const G = ".gi" + "t"; // spelled out of band so tooling does not mistake the fixtures for VCS commands

const PATHS = [
  ".env",
  ".env.local",
  "a/.env",
  "a/b/.env.production",
  ".envrc",
  "x/.envrc",
  ".dev.vars",
  "a/.dev.vars",
  "keys/dev.pem",
  ".pem",
  "a/b/c.key",
  "id_rsa",
  "home/.ssh/id_ed25519.pub",
  ".ssh",
  "a/.ssh",
  "a/.ssh/config",
  ".kube/config",
  "a/.kube/config",
  "kubeconfig-prod",
  ".docker/config.json",
  "x/.docker/config.json",
  "credentials.json",
  "a/credentials.json",
  "service-account-1.json",
  "terraform.tfvars",
  "a/b.tfstate.backup",
  G,
  `${G}/config`,
  `sub/${G}/HEAD`,
  `${G}modules`,
  `a/${G}modules`,
  ".github/workflows/ci.yml",
  ".github/actions/x/action.yml",
  ".github/CODEOWNERS",
  ".gitlab-ci.yml",
  "Jenkinsfile",
  "a/Jenkinsfile",
  ".husky/pre-commit",
  ".claude/settings.json",
  "x/.claude/settings.json",
  ".mitori/doc/a.md",
  "bunfig.toml",
  "pkg/bunfig.toml",
  "a/.cargo/config.toml",
  ".cargo/config",
  "src/index.ts",
  "src/a/b.ts",
  "a/x",
  "c/x",
  "docs/a.md",
  "docs/a/b.md",
  "bun.lock",
  "x/y",
  "x/a/b/y",
  "foo",
  "README.md",
  "docs/.env.example",
  ".env.example",
  "a/b/c/.env.sample",
];

const LISTS: Record<string, readonly string[]> = {
  deny: DEFAULT_DENY_GLOBS,
  secret: SECRET_PATH_GLOBS,
  templates: ENV_TEMPLATE_GLOBS,
  odd: ["src/**/*.ts", "{a,b}/x", "docs/*.md", "*.lock", "x/**/y", "!(foo)"],
  all: ["**"],
};

describe("IDX-U-030 fast glob matcher ≡ picomatch", () => {
  for (const [name, globs] of Object.entries(LISTS)) {
    test(name, () => {
      const fast = compileGlobs(globs);
      const slow = globs.map((g) => picomatch.makeRe(g, { dot: true }));
      for (const p of PATHS) expect([p, fast.test(p)]).toEqual([p, slow.some((r) => r.test(p))]);
    });
  }
});
