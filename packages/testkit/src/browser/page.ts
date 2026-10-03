// Structural views of a Playwright page: the contract's `PageLike` only has `goto` (so contract.ts stays free of Playwright
// types); the helpers need a little more. A real `import("playwright").Page` satisfies all of these.
import { MitoriError } from "@mitori/core";
import type { PageLike } from "../contract.ts";

export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface PwPage extends PageLike {
  evaluate<R = unknown>(fn: string | ((arg: never) => R | Promise<R>), arg?: unknown): Promise<R>;
  /** Chromium only. */
  context(): { newCDPSession(page: unknown): Promise<CdpSessionLike> };
  addInitScript?(script: string | (() => void) | { content: string }): Promise<void>;
}

/** Narrow a `PageLike` to something that can evaluate scripts; throws a readable error for a bare `{ goto }`. */
export function asPwPage(page: PageLike): PwPage {
  if (typeof (page as Partial<PwPage>).evaluate !== "function") {
    throw new MitoriError("E_INVALID_INPUT", "testkit browser helpers need a Playwright page (evaluate() is missing)");
  }
  return page as PwPage;
}

const sessions = new WeakMap<object, Promise<CdpSessionLike>>();

/** One CDP session per page (Chromium). Rejects with `E_UNSUPPORTED` on browsers without CDP. */
export function cdp(page: PwPage): Promise<CdpSessionLike> {
  let s = sessions.get(page);
  if (!s) {
    s = (async () => {
      try {
        return await page.context().newCDPSession(page);
      } catch (err) {
        throw new MitoriError("E_UNSUPPORTED", "this needs a CDP session (Chromium only)", { cause: err });
      }
    })();
    sessions.set(page, s);
    s.catch(() => sessions.delete(page));
  }
  return s;
}
