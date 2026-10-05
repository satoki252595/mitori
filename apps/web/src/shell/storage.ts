/**
 * The ONLY place that touches `localStorage` / `sessionStorage` / `document.cookie` (lint
 * `mitori/storage-wrapper`, ux.md §12.11). Every access is try/catch: private windows, blocked site data and
 * quota errors degrade to "nothing stored", never to an exception.
 */
type Area = "local" | "session";
let serverValues: ReadonlyMap<string, string> | null = null;

/** Synchronous server render only; the caller supplies the bounded reading UI keys, never credentials. */
export function withServerStorage<T>(values: ReadonlyMap<string, string>, render: () => T): T {
  const previous = serverValues;
  serverValues = values;
  try {
    return render();
  } finally {
    serverValues = previous;
  }
}

function area(a: Area): Storage | null {
  try {
    return a === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function getItem(a: Area, key: string): string | null {
  try {
    if (serverValues) return serverValues.get(`${a}:${key}`) ?? null;
    return area(a)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setItem(a: Area, key: string, value: string): boolean {
  try {
    area(a)?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(a: Area, key: string): void {
  try {
    area(a)?.removeItem(key);
  } catch {
    /* ignored */
  }
}

export function getJson<T>(a: Area, key: string): T | null {
  const raw = getItem(a, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJson(a: Area, key: string, value: unknown): boolean {
  return setItem(a, key, JSON.stringify(value));
}

export function readCookies(): string {
  try {
    return typeof document === "undefined" ? "" : document.cookie;
  } catch {
    return "";
  }
}

export function writeCookie(assignment: string): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: the head script reads this cookie synchronously (CookieStore is async)
    if (typeof document !== "undefined") document.cookie = assignment;
  } catch {
    /* ignored */
  }
}

/** Storage keys (ux.md §12.11). */
export const STORAGE_KEYS = {
  draft: (ws: string, anchorKey: string) => `mitori:draft:${ws}:${anchorKey}`,
  read: (ws: string, pathId: string) => `mitori:read:${ws}:${pathId}`,
  recent: (ws: string) => `mitori:recent:${ws}`,
  lastPage: (ws: string) => `mitori:lastPage:${ws}`,
  /** Last S3 file of the tab (`g c`, ux.md §8.4). */
  lastFile: (ws: string) => `mitori:lastFile:${ws}`,
  path: (ws: string) => `mitori:path:${ws}`,
  /** The header's project chip as last shown (name · HEAD · tag): drawn at once on the next visit (AC-U03). */
  proj: (ws: string) => `mitori:proj:${ws}`,
  imeHint: "mitori:hint:imeOn",
  hint: (id: string) => `mitori:hint:${id}`,
} as const;
