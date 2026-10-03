import { describe, expect, test } from "bun:test";
import { ERROR_CODES, ERROR_META } from "./domain.ts";
import { isErrorCode, isMitoriErrorData, MitoriError, toErrorData, unsupported, unsupportedValue } from "./errors.ts";

describe("MitoriError", () => {
  test("ERROR_META covers every code exactly once", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(Object.keys(ERROR_META).sort()).toEqual([...ERROR_CODES].sort());
  });

  test("defaults retryability and http from ERROR_META; serializes without the stack", () => {
    const e = new MitoriError("E_CONFLICT", "busy", { params: { path: "a.ts" }, hint: "retry" });
    expect(e.retryable).toBe(true);
    expect(e.http).toBe(409);
    expect(e.toData("rq_0000000000")).toEqual({
      code: "E_CONFLICT",
      message: "busy",
      retryable: true,
      params: { path: "a.ts" },
      hint: "retry",
      requestId: "rq_0000000000",
    });
    expect(new MitoriError("E_CONFLICT", "x", { retryable: false }).retryable).toBe(false);
  });

  test("from() keeps MitoriErrors, revives wire data, wraps anything else as E_INTERNAL with a cause", () => {
    const e = new MitoriError("E_NOT_FOUND");
    expect(MitoriError.from(e)).toBe(e);
    expect(MitoriError.from(e.toData()).code).toBe("E_NOT_FOUND");
    const wrapped = MitoriError.from(new TypeError("boom"));
    expect(wrapped.code).toBe("E_INTERNAL");
    expect(wrapped.toData().cause).toEqual({ message: "boom" });
    expect(toErrorData("str").message).toBe("str");
    expect(new MitoriError("E_GIT_FAILED", "x", { cause: new MitoriError("E_TIMEOUT", "slow") }).toData().cause).toEqual({
      code: "E_TIMEOUT",
      message: "slow",
    });
  });

  test("guards", () => {
    expect(isErrorCode("E_UNSUPPORTED")).toBe(true);
    expect(isErrorCode("E_NOPE")).toBe(false);
    expect(isMitoriErrorData({ code: "E_INTERNAL", message: "m", retryable: false })).toBe(true);
    expect(isMitoriErrorData({ code: "E_INTERNAL" })).toBe(false);
    expect(MitoriError.is(new MitoriError("E_CSRF"), "E_CSRF")).toBe(true);
    expect(MitoriError.is(new Error("x"))).toBe(false);
  });

  test("stubs: unsupported() and unsupportedValue() throw E_UNSUPPORTED naming the export", () => {
    expect(() => unsupported("pkg.fn", 1, 2)).toThrow("pkg.fn is not implemented yet");
    const v = unsupportedValue<{ a: number }>("pkg.VALUE");
    expect(() => v.a).toThrow(MitoriError);
    expect((v as unknown as { then?: unknown }).then).toBeUndefined();
    try {
      unsupported("pkg.fn");
    } catch (e) {
      expect(MitoriError.is(e, "E_UNSUPPORTED")).toBe(true);
      expect((e as MitoriError).http).toBe(501);
    }
  });
});
