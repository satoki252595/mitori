import { MitoriError } from "./errors.ts";

/**
 * Canonical JSON (gen spec §10.8, CORE-U-002): object keys sorted by UTF-16 code unit, 2-space indent, LF,
 * trailing newline. `undefined` / function members are omitted (array slots become `null`, as in JSON), `-0`
 * is written `0`, non-finite numbers, bigints and cycles are rejected (`E_INVALID_INPUT`). Non-ASCII text is
 * not escaped. `toJSON()` is honoured. Same value ⇒ same bytes.
 */
export function canonicalJson(value: unknown): string {
  const out = write(value, "", new Set());
  if (out === undefined) throw new MitoriError("E_INVALID_INPUT", "canonicalJson: top-level value is not serializable");
  return `${out}\n`;
}

function write(v: unknown, indent: string, stack: Set<object>): string | undefined {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new MitoriError("E_INVALID_INPUT", `canonicalJson: non-finite number ${v}`);
      return Object.is(v, -0) ? "0" : JSON.stringify(v);
    case "bigint":
      throw new MitoriError("E_INVALID_INPUT", "canonicalJson: bigint is not JSON");
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }
  const obj = v as object & { toJSON?: () => unknown };
  if (typeof obj.toJSON === "function") return write(obj.toJSON(), indent, stack);
  if (stack.has(obj)) throw new MitoriError("E_INVALID_INPUT", "canonicalJson: cyclic structure");
  stack.add(obj);
  const inner = `${indent}  `;
  let out: string;
  if (Array.isArray(obj)) {
    const items = obj.map((x) => write(x, inner, stack) ?? "null");
    out = items.length === 0 ? "[]" : `[\n${inner}${items.join(`,\n${inner}`)}\n${indent}]`;
  } else {
    const parts: string[] = [];
    for (const k of Object.keys(obj).sort()) {
      const s = write((obj as Record<string, unknown>)[k], inner, stack);
      if (s !== undefined) parts.push(`${JSON.stringify(k)}: ${s}`);
    }
    out = parts.length === 0 ? "{}" : `{\n${inner}${parts.join(`,\n${inner}`)}\n${indent}}`;
  }
  stack.delete(obj);
  return out;
}
