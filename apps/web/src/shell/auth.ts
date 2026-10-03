/**
 * Browser login (api `PAGE_ROUTES.auth`, SEC-06): `GET /auth#n=<nonce>&to=<path>` serves the shell; the nonce
 * lives in the FRAGMENT (never sent to the server, never in logs/Referer). We exchange it once for a session token,
 * keep the token in `localStorage[LOCAL_KEYS.session]` (origin = port) and `replaceState` to `to`.
 */
import type { ApiClient } from "@mitori/client";
import { LOCAL_KEYS, PAGE_ROUTES } from "@mitori/core";
import { setItem } from "./storage.ts";

export function parseAuthFragment(hash: string): { nonce: string; to: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const nonce = p.get("n");
  if (!nonce || !/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) return null;
  const to = p.get("to") ?? "/";
  return { nonce, to: isAppPath(to) ? to : "/" };
}

/**
 * Only same-origin app paths: a leading `/` not followed by `/` or `\` (browsers read `/\host` as `//host`), and no
 * backslash, whitespace or control character anywhere (a cross-origin `replaceState` would throw and stop the boot).
 */
export function isAppPath(to: string): boolean {
  return /^\/(?![/\\])[^\\\s\p{Cc}]*$/u.test(to);
}

/** Returns true when an exchange happened (the URL was rewritten). Failures leave the tab unauthenticated. */
export async function completeLogin(api: ApiClient, loc: Pick<Location, "pathname" | "hash">, hist: Pick<History, "replaceState">): Promise<boolean> {
  if (loc.pathname !== PAGE_ROUTES.auth) return false;
  const f = parseAuthFragment(loc.hash);
  // drop the fragment from the address bar immediately, whatever happens next
  hist.replaceState(null, "", f?.to ?? "/");
  if (!f) return false;
  try {
    const res = await api.call("POST /auth/exchange", { params: {}, body: { nonce: f.nonce } });
    setItem("local", LOCAL_KEYS.session, res.token);
    return true;
  } catch {
    return false;
  }
}
