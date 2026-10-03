/** Plain-object helpers for settings documents (JSON values only). */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** `patch` over `base`: objects merge recursively, everything else (arrays included) replaces; `undefined` is skipped. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** The parts of `value` that differ from `defaults` (what a sparse config file needs to store). */
export function diffFrom(value: unknown, defaults: unknown): unknown {
  if (!isPlainObject(value) || !isPlainObject(defaults)) return deepEqual(value, defaults) ? undefined : value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const d = diffFrom(v, defaults[k]);
    if (d !== undefined) out[k] = d;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** Leaf paths of an object (a non-object value or an empty object at the root yields none). */
export function leafPaths(v: unknown, prefix = ""): { path: string; value: unknown }[] {
  if (!isPlainObject(v)) return prefix === "" ? [] : [{ path: prefix, value: v }];
  return Object.entries(v).flatMap(([k, x]) => (x === undefined ? [] : leafPaths(x, prefix === "" ? k : `${prefix}.${k}`)));
}

export function getPath(obj: unknown, dotted: string): unknown {
  let v: unknown = obj;
  for (const k of dotted.split(".")) v = isPlainObject(v) ? v[k] : undefined;
  return v;
}

/** `{a: {b: value}}` for `a.b`. */
export function patchAt(dotted: string, value: unknown): Record<string, unknown> {
  const keys = dotted.split(".");
  let out: unknown = value;
  for (let i = keys.length - 1; i >= 0; i--) out = { [keys[i] as string]: out };
  return out as Record<string, unknown>;
}
