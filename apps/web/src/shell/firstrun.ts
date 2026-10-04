/**
 * First run (NC-08): a browser that has never shown mitori (no reader level in the `mitori_ui` cookie, no first-run
 * mark) starts at 「初めて」 — and with it the 5-minute course (reading.ts `defaultPathId`). Decided in main.ts before
 * the Shell mounts (the static skeleton has no level-dependent content: no layout shift), persisted like any level
 * change (cookie + `PATCH /settings`). A level chosen elsewhere (the server says 詳しい / 初めて) is kept; only the
 * untouched default 「標準」 is replaced, once.
 */
import type { ReaderLevel } from "@mitori/core";

export const FIRST_RUN_KEY = "mitori:firstRun";

export function firstRunLevel(o: { cookieHasLevel: boolean; seen: boolean; current: ReaderLevel }): ReaderLevel | null {
  if (o.cookieHasLevel || o.seen) return null;
  return o.current === "standard" ? "newcomer" : null;
}

/** The welcome card of §0 (the 5-minute course) is dismissed per workspace. */
export const welcomeKey = (ws: string): string => `mitori:welcome:${ws}`;
