/**
 * CR setup-save-1: every route the CLI calls must accept cli clients. `PATCH /settings` used to be web-only, so
 * `mitori setup` always died with E_FORBIDDEN after writing the exec half. This static test reads the production
 * sources (no daemon) and fails on the next web-only route the CLI starts calling.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROUTE_META, type RouteKey } from "@mitori/core";

const SRC = join(import.meta.dir, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "test") sources(path, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const files = sources(SRC);
const called = new Map<string, string[]>();
const dynamic: string[] = [];
for (const path of files) {
  const text = readFileSync(path, "utf8");
  for (const m of text.matchAll(/\.call\(\s*"([^"]+)"/g)) {
    const list = called.get(m[1] ?? "") ?? [];
    list.push(path);
    called.set(m[1] ?? "", list);
  }
  for (const m of text.matchAll(/\.call\(\s*[`']/g)) dynamic.push(`${path}:${m.index ?? 0}`);
}

describe("CR setup-save-1 CLI route clients", () => {
  test("every statically known route accepts cli clients (or any authenticated caller)", () => {
    expect([...called.keys()].length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const [route, paths] of [...called.entries()].sort()) {
      const meta = (ROUTE_META as Record<string, { clients?: readonly string[] }>)[route];
      if (!meta) {
        violations.push(`${route} (unknown route, called from ${paths.join(", ")})`);
        continue;
      }
      if (meta.clients && !meta.clients.includes("cli")) violations.push(`${route} (clients: ${meta.clients.join(",")})`);
    }
    expect(violations).toEqual([]);
  });

  test("every statically known route is a real RouteKey", () => {
    const unknown = [...called.keys()].filter((route) => !(route in ROUTE_META));
    expect(unknown).toEqual([]);
  });

  test("no dynamic route names the static scan cannot see", () => {
    expect(dynamic).toEqual([]);
  });

  test("the setup save path is covered", () => {
    expect([...called.keys()]).toContain("PATCH /settings");
    expect([...called.keys()]).toContain("PATCH /settings/exec");
    expect((ROUTE_META["PATCH /settings"] as { clients?: readonly string[] }).clients).toContain("cli");
    expect((ROUTE_META["PATCH /settings/exec"] as { clients?: readonly string[] }).clients).toContain("cli");
    expect("PATCH /settings" satisfies RouteKey).toBe("PATCH /settings");
  });
});
