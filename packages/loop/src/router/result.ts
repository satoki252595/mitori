import { type ErrorCode, MitoriError, type Result } from "@mitori/core";

/** Suggested next actions carried in `params.actions` (comma-separated; `MitoriErrorData.params` holds primitives only). */
export type RouterAction = "narrow_scope" | "copy_prompt" | "other_engine" | "escalate" | "retry";

/** A failed router result: code + English message + optional actions and extra params. */
export function fail(
  code: ErrorCode,
  message: string,
  opts: { actions?: RouterAction[]; params?: Record<string, string | number | boolean>; hint?: string } = {},
): Result<never> {
  const params: Record<string, string | number | boolean> = { ...opts.params };
  if (opts.actions && opts.actions.length > 0) params.actions = opts.actions.join(",");
  const err = new MitoriError(code, message, { params, ...(opts.hint !== undefined ? { hint: opts.hint } : {}) });
  return { ok: false, error: err.toData() };
}
