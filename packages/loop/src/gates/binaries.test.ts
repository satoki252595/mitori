// F9 (nonfunc audit): a formatter's trust covers what the binary is — a swapped `node_modules` / `.venv` asks again;
// a `#!` launcher runs dependency code (never a pure formatter); biome runs as its native build.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileEntry, GateSpec } from "@mitori/core";
import { createFsReader, createHasher } from "@mitori/platform";
import { createTestHome, type TestHome } from "@mitori/testkit/home";
import { binaryInfos, localBinaryCandidates } from "./binaries.ts";
import { type DetectInput, detectFormatGates } from "./detect.ts";

const hasher = createHasher();
const env = { pathDirs: ["/tool/bin"], root: "/repo", hasher };
const entry = (path: string): FileEntry =>
  ({ path, blob: "0".repeat(40), size: 1, lang: "generic", class: "source", lines: 1, loc: 1, tokensEst: 1 }) as FileEntry;

function input(files: Record<string, string>, bins: Record<string, { digest: string; script: boolean }>, dirs: Record<string, string[]> = {}): DetectInput {
  return {
    files: Object.keys(files).map(entry),
    facts: [],
    changed: Object.keys(files).filter((p) => /\.(ts|py)$/.test(p)),
    readConfig: (p) => files[p] ?? null,
    binaryExists: (abs) => abs in bins,
    binaryInfo: (abs) => bins[abs] ?? null,
    readdir: (abs) => dirs[abs] ?? null,
  };
}

describe("F9 formatter identity", () => {
  const js = { "package.json": "{}", "biome.json": "{}", "src/a.ts": "" };
  const launcher = { digest: "L1", script: true };
  const native = (digest: string) => ({ digest, script: false });

  test("biome runs as its native build (pure formatter); the launcher alone counts as repo code", () => {
    const withNative = detectFormatGates(
      env,
      input(
        js,
        { "/repo/node_modules/.bin/biome": launcher, "/repo/node_modules/@biomejs/cli-darwin-arm64/biome": native("N1") },
        {
          "/repo/node_modules/@biomejs": ["biome", "cli-darwin-arm64"],
        },
      ),
    );
    expect(withNative.map((g) => [g.id, g.argvTemplate[0], g.executesRepoCode])).toEqual([
      ["fmt:biome", "node_modules/@biomejs/cli-darwin-arm64/biome", false],
    ]);
    const only = detectFormatGates(env, input(js, { "/repo/node_modules/.bin/biome": launcher }));
    expect(only.map((g) => [g.argvTemplate[0], g.executesRepoCode])).toEqual([["node_modules/.bin/biome", true]]);
    // glibc wins over musl; two glibc builds are ambiguous ⇒ the launcher
    const two = (names: string[]) =>
      detectFormatGates(
        env,
        input(
          js,
          Object.fromEntries([["/repo/node_modules/.bin/biome", launcher], ...names.map((n) => [`/repo/node_modules/@biomejs/${n}/biome`, native(n)])]),
          { "/repo/node_modules/@biomejs": names },
        ),
      )[0]?.argvTemplate[0];
    expect(two(["cli-linux-x64", "cli-linux-x64-musl"])).toBe("node_modules/@biomejs/cli-linux-x64/biome");
    expect(two(["cli-linux-x64", "cli-darwin-arm64"])).toBe("node_modules/.bin/biome");
  });

  test("the trust hash changes when the binary changes (npm install of another biome), not otherwise", () => {
    const hashOf = (digest: string) =>
      (
        detectFormatGates(
          env,
          input(
            js,
            { "/repo/node_modules/.bin/biome": launcher, "/repo/node_modules/@biomejs/cli-darwin-arm64/biome": native(digest) },
            {
              "/repo/node_modules/@biomejs": ["cli-darwin-arm64"],
            },
          ),
        )[0] as GateSpec
      ).trustHash;
    expect(hashOf("N1")).toBe(hashOf("N1"));
    expect(hashOf("N2")).not.toBe(hashOf("N1"));
  });

  test("Python: a .venv console-script launcher (black) runs site-packages ⇒ repo code; a native .venv ruff does not; both hashed", () => {
    const blackGates = detectFormatGates(
      env,
      input({ "pyproject.toml": "[tool.black]\n", "x.py": "" }, { "/repo/.venv/bin/black": { digest: "B1", script: true } }),
    );
    expect(blackGates.map((g) => [g.id, g.executesRepoCode])).toEqual([["fmt:black", true]]);
    const ruff = (digest: string) =>
      detectFormatGates(env, input({ "pyproject.toml": "[tool.ruff]\n", "x.py": "" }, { "/repo/.venv/bin/ruff": { digest, script: false } }))[0] as GateSpec;
    expect(ruff("R1").executesRepoCode).toBe(false);
    expect(ruff("R2").trustHash).not.toBe(ruff("R1").trustHash);
  });
});

describe("F9 binary digests on disk", () => {
  let home: TestHome;
  let root: string;
  beforeEach(async () => {
    home = await createTestHome();
    root = realpathSync(home.dir);
  });
  afterEach(async () => {
    await home.cleanup();
  });

  test("realpath + bytes, the launcher flag, a cache keyed by the file's identity, the candidates per manifest dir", async () => {
    const fs = createFsReader();
    mkdirSync(join(root, "node_modules/@biomejs/biome/bin"), { recursive: true });
    mkdirSync(join(root, "node_modules/@biomejs/cli-darwin-arm64"), { recursive: true });
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(root, "node_modules/@biomejs/biome/bin/biome"), "#!/usr/bin/env node\nrequire('x')\n");
    chmodSync(join(root, "node_modules/@biomejs/biome/bin/biome"), 0o755);
    symlinkSync("../@biomejs/biome/bin/biome", join(root, "node_modules/.bin/biome"));
    writeFileSync(join(root, "node_modules/@biomejs/cli-darwin-arm64/biome"), new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3]));
    const cands = localBinaryCandidates(fs, root, ["src/a.ts"]);
    expect(cands).toContain(`${root}/node_modules/.bin/biome`);
    expect(cands).toContain(`${root}/node_modules/@biomejs/cli-darwin-arm64/biome`);
    expect(cands).toContain(`${root}/src/node_modules/.bin/biome`);
    const a = await binaryInfos(fs, hasher, cands);
    expect([...a.keys()].sort()).toEqual([`${root}/node_modules/.bin/biome`, `${root}/node_modules/@biomejs/cli-darwin-arm64/biome`]);
    expect(a.get(`${root}/node_modules/.bin/biome`)?.script).toBe(true);
    expect(a.get(`${root}/node_modules/@biomejs/cli-darwin-arm64/biome`)?.script).toBe(false);
    // a swapped native binary (same size even) has another digest
    await Bun.sleep(5);
    writeFileSync(join(root, "node_modules/@biomejs/cli-darwin-arm64/biome"), new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 9, 9, 9]));
    const b = await binaryInfos(fs, hasher, cands);
    expect(b.get(`${root}/node_modules/@biomejs/cli-darwin-arm64/biome`)?.digest).not.toBe(
      a.get(`${root}/node_modules/@biomejs/cli-darwin-arm64/biome`)?.digest,
    );
    expect(b.get(`${root}/node_modules/.bin/biome`)?.digest).toBe(a.get(`${root}/node_modules/.bin/biome`)?.digest);
  });
});
