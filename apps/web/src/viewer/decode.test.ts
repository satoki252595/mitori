import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { decodeExportPayload } from "./decode.ts";

const b64 = (s: string): string => gzipSync(s, { level: 9 }).toString("base64");

describe("EXP-U-04 export payload decode", () => {
  test("gzip+base64: the foreign payload decodes, so the format check can name it", async () => {
    const payload = await decodeExportPayload(b64('{"format":"mitori.export/9"}'), "gzip+base64");
    expect(String(payload.format)).toBe("mitori.export/9");
  });
  test("no data-encoding: plain JSON parses (older exports, and test exports without a compressor)", async () => {
    const payload = await decodeExportPayload('{"format":"mitori.export/1"}', undefined);
    expect(payload.format).toBe("mitori.export/1");
  });
  test("a truncated gzip body rejects (damaged, not blank)", async () => {
    // note: the tiny body above gzips to exactly 64 base64 chars, so slice from a body longer than that
    const big = b64(JSON.stringify({ format: "mitori.export/1", pad: "x".repeat(500) }));
    expect(big.length).toBeGreaterThan(64);
    await expect(decodeExportPayload(big.slice(0, 64), "gzip+base64")).rejects.toThrow();
  });
  test("gzip bytes that are not JSON reject", async () => {
    await expect(decodeExportPayload(b64("not json {{{"), "gzip+base64")).rejects.toThrow();
  });
  test("broken plain JSON rejects", async () => {
    await expect(decodeExportPayload("{{{", undefined)).rejects.toThrow();
  });
});
