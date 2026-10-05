import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { typecheck } from "./typecheck.ts";

test("checked solution build rejects noCheck-only cache errors in every transitive project and reuses checked state", async () => {
  const root = mkdtempSync(join(tmpdir(), "mitori-typecheck-"));
  const json = (path: string, value: unknown) => writeFileSync(join(root, path), JSON.stringify(value));
  const logs: string[] = [];
  try {
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name));
      json(`${name}/tsconfig.json`, {
        compilerOptions: {
          composite: true,
          declaration: true,
          emitDeclarationOnly: true,
          strict: true,
          skipLibCheck: true,
          target: "ES2023",
          module: "ESNext",
          moduleResolution: "bundler",
          types: [],
          outDir: `../build/${name}`,
        },
        include: ["index.ts"],
        ...(name === "b" ? { references: [{ path: "../a" }] } : {}),
      });
    }
    // Only b is listed at the solution level; a must be discovered through b's reference.
    json("tsconfig.json", { files: [], references: [{ path: "b" }] });
    writeFileSync(join(root, "a/index.ts"), "export const value: string = 1;\n");
    writeFileSync(join(root, "b/index.ts"), 'import { value } from "../a/index"; export const result: number = value;\n');
    const seed = Bun.spawn(["tsc", "-b", "--noCheck", "--pretty", "false"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [, , seeded] = await Promise.all([new Response(seed.stdout).text(), new Response(seed.stderr).text(), seed.exited]);
    expect(seeded).toBe(0);
    expect(existsSync(join(root, "build/a/index.d.ts"))).toBe(true);
    expect(existsSync(join(root, "build/b/index.d.ts"))).toBe(true);
    expect(typecheck(root, (line) => logs.push(line))).toBe(1);
    expect(logs.some((line) => line.startsWith("a/index.ts(") && line.includes("TS2322"))).toBe(true);
    expect(logs.some((line) => line.startsWith("b/index.ts(") && line.includes("TS2322"))).toBe(true);
    expect(logs.at(-1)).toContain("2 projects, 2 semantic builds, 2 error(s)");
    writeFileSync(join(root, "a/index.ts"), 'export const value: string = "ok";\n');
    writeFileSync(join(root, "b/index.ts"), 'import { value } from "../a/index"; export const result: string = value;\n');
    expect(typecheck(root, () => {})).toBe(0);
    logs.length = 0;
    expect(typecheck(root, (line) => logs.push(line))).toBe(0);
    expect(logs.at(-1)).toContain("2 projects, 0 semantic builds, 2 cached, 0 error(s)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
