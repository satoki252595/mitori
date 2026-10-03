import { ERROR_CODES, ERROR_META, type ErrorCode, type MitoriErrorData, type RequestId } from "./domain.ts";

/** Options of a {@link MitoriError}. */
export interface MitoriErrorOptions {
  /** Interpolation params for the i18n message (no secrets, no file contents). */
  params?: Record<string, string | number | boolean>;
  /** Overrides the default retryability of the code ({@link ERROR_META}). */
  retryable?: boolean;
  /** Short actionable hint (English). */
  hint?: string;
  /** Wrapped cause (only code/message ever cross the wire). */
  cause?: unknown;
}

const CODES: ReadonlySet<string> = new Set(ERROR_CODES);

/** True for a known {@link ErrorCode}. */
export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && CODES.has(code);
}

/**
 * The one error class of mitori. Serializes to {@link MitoriErrorData} for HTTP bodies, job failures and NDJSON;
 * the stack never crosses the wire.
 */
export class MitoriError extends Error {
  /** Code. */
  readonly code: ErrorCode;
  /** i18n params. */
  readonly params: Record<string, string | number | boolean> | undefined;
  /** Retryability (defaults from {@link ERROR_META}). */
  readonly retryable: boolean;
  /** Hint. */
  readonly hint: string | undefined;

  constructor(code: ErrorCode, message: string = code, opts: MitoriErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "MitoriError";
    this.code = code;
    this.params = opts.params;
    this.retryable = opts.retryable ?? ERROR_META[code].retryable;
    this.hint = opts.hint;
  }

  /** HTTP status of the code. */
  get http(): number {
    return ERROR_META[this.code].http;
  }

  /** Wire form. */
  toData(requestId?: RequestId): MitoriErrorData {
    const data: MitoriErrorData = { code: this.code, message: this.message, retryable: this.retryable };
    if (this.params !== undefined) data.params = this.params;
    if (this.hint !== undefined) data.hint = this.hint;
    const cause = causeOf(this.cause);
    if (cause !== undefined) data.cause = cause;
    if (requestId !== undefined) data.requestId = requestId;
    return data;
  }

  /** `err` as a MitoriError; anything else becomes `E_INTERNAL` with `err` as the cause. */
  static from(err: unknown): MitoriError {
    if (err instanceof MitoriError) return err;
    if (isMitoriErrorData(err)) {
      const opts: MitoriErrorOptions = { retryable: err.retryable };
      if (err.params !== undefined) opts.params = err.params;
      if (err.hint !== undefined) opts.hint = err.hint;
      return new MitoriError(err.code, err.message, opts);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new MitoriError("E_INTERNAL", message, { cause: err });
  }

  /** Type guard, optionally narrowed to one code. */
  static is(err: unknown, code?: ErrorCode): err is MitoriError {
    return err instanceof MitoriError && (code === undefined || err.code === code);
  }
}

function causeOf(cause: unknown): MitoriErrorData["cause"] | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof MitoriError) return { code: cause.code, message: cause.message };
  if (cause instanceof Error) return { message: cause.message };
  return { message: String(cause) };
}

/** Structural check of a serialized error. */
export function isMitoriErrorData(v: unknown): v is MitoriErrorData {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isErrorCode(o.code) && typeof o.message === "string" && typeof o.retryable === "boolean";
}

/** Serialize any thrown value. */
export function toErrorData(err: unknown, requestId?: RequestId): MitoriErrorData {
  return MitoriError.from(err).toData(requestId);
}

/**
 * Body of every M0 stub: throws `E_UNSUPPORTED` naming the stubbed export. The arguments are accepted (and
 * ignored) so stubs keep their contract parameter names without tripping `noUnusedParameters`.
 */
export function unsupported(what: string, ..._args: unknown[]): never {
  throw new MitoriError("E_UNSUPPORTED", `${what} is not implemented yet`, { params: { what } });
}

/**
 * Placeholder for a stubbed exported VALUE (object/const): importing it is safe, touching any property throws
 * `E_UNSUPPORTED`. (`then` reads as undefined so the proxy is not mistaken for a thenable.)
 */
export function unsupportedValue<T>(what: string): T {
  const fail = (): never => unsupported(what);
  return new Proxy(Object.create(null) as object, {
    get: (_t, key) => (key === "then" || typeof key === "symbol" ? undefined : fail()),
    has: fail,
    ownKeys: fail,
    apply: fail,
  }) as T;
}
