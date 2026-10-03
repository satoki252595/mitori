import type { Glob } from "@mitori/core";
import { ACCEPT_FIXED } from "../contract.ts";

/** `DENY <globs>`: sorted (dictionary order) and de-duplicated, so the same settings give the same bytes. */
export function denyLine(globs: readonly Glob[]): string {
  return `DENY ${[...new Set(globs)].sort().join(" ")}`;
}

/** The fixed ACCEPT bullets that do not depend on the task (spec §4.3, `ACCEPT_FIXED`). */
export function acceptFixedBullets(): string[] {
  return [ACCEPT_FIXED.write, ACCEPT_FIXED.scope];
}
