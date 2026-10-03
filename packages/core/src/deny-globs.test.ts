import { describe, expect, test } from "bun:test";
import picomatch from "picomatch";
import { DEFAULT_DENY_GLOBS, ENV_TEMPLATE_GLOBS, SECRET_PATH_GLOBS } from "./domain.ts";

// Deny globs are matched with picomatch `{ dot: true }` (they must reach into dot-directories). Owners of the
// matchers (loop router / git safety, indexer S0) use the same options.
const deny = picomatch([...DEFAULT_DENY_GLOBS], { dot: true });

describe("CORE-U-007 DEFAULT_DENY_GLOBS", () => {
  test("credentials, CI, git internals, agent configs and docDir are denied", () => {
    for (const p of [
      ".env",
      ".env.local",
      "a/.env",
      "x/y.pem",
      ".github/workflows/ci.yml",
      ".mitori/doc/a.md",
      "a/.git/config",
      "k/.aws/credentials",
      ".claude/settings.json",
    ])
      expect(deny(p)).toBe(true);
  });

  // M0 note: the testing spec table predates R1 — `.envrc` is an execution trigger (SEC-12) and `docs/.env.md`
  // matches `**/.env.*`; both ARE denied by the contract (recorded in packages/core/CR-LEDGER.md, CR m0-5).
  test("R1 additions: .envrc and any .env.* are denied", () => {
    expect(deny(".envrc")).toBe(true);
    expect(deny("docs/.env.md")).toBe(true);
  });

  test("ordinary sources are not denied", () => {
    for (const p of ["env.ts", "src/env/config.ts", "docs/env.md", "package.json", "README.md", "src/.environment.ts"]) expect(deny(p)).toBe(false);
  });

  test("env templates are a subset of the denied set and of .env.*", () => {
    for (const g of ENV_TEMPLATE_GLOBS) expect(deny(g.replace("**/", "a/"))).toBe(true);
    expect(SECRET_PATH_GLOBS.every((g) => (DEFAULT_DENY_GLOBS as readonly string[]).includes(g))).toBe(true);
  });
});
