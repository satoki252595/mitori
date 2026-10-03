// Byte-exact goldens under fixtures/golden/ (testing spec §2.5). `MITORI_UPDATE_GOLDEN=1` (re)writes them.
// CR-PENDING(WP-02): switch to @mitori/testkit `expectGolden` once WP-12 implements it (it is an M0 stub today).
import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "@mitori/core";
import { REPO_ROOT } from "../../parse/test/env.ts";

export const GOLDEN_ROOT = join(REPO_ROOT, "fixtures/golden");
const UPDATE = process.env.MITORI_UPDATE_GOLDEN === "1";

/**
 * Bidi controls and zero-width characters never sit raw in the repository (fixtures/truth/security-fixtures.test.ts):
 * goldens store them as `\u{…}` (the injection fixture generates them at build time).
 */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
const visible = (t: string): string => t.replace(INVISIBLE, (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`);

/** Compare `actual` with `fixtures/golden/<rel>` (objects as canonical JSON). */
export function expectGolden(rel: string, actual: string | object): void {
  const text = visible(typeof actual === "string" ? actual : canonicalJson(actual));
  const file = join(GOLDEN_ROOT, rel);
  if (UPDATE) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  if (!existsSync(file)) throw new Error(`missing golden ${rel} — run with MITORI_UPDATE_GOLDEN=1`);
  expect([rel, text]).toEqual([rel, readFileSync(file, "utf8")]);
}

/** Paths that are safe as golden file names on every OS. */
export const goldenSafe = (p: string): boolean => /^[A-Za-z0-9._/-]+$/.test(p) && !p.includes("..");
