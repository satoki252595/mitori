import { describe, expect, test } from "bun:test";
import { SECURITY_HEADERS } from "@mitori/core";
import type { WebAssets } from "../build/assets.ts";
import { createStaticHandler, negotiate, securityHeaders } from "./static.ts";

const enc = new TextEncoder();
const assets: WebAssets = new Map([
  ["/index.html", { raw: enc.encode("<!doctype html><div id=app></div>"), br: enc.encode("BR-HTML"), gz: enc.encode("GZ-HTML"), immutable: false }],
  ["/assets/index-abc.js", { raw: enc.encode("console.log(1)"), br: enc.encode("BR-JS"), immutable: true }],
  ["/favicon.ico", { raw: new Uint8Array([0, 0, 1, 0]), immutable: false }],
]);
const serve = createStaticHandler(assets);
const get = (path: string, headers: Record<string, string> = {}, method = "GET") => {
  const url = new URL(path, "http://127.0.0.1:4000");
  return serve(new Request(url, { method, headers }), url);
};

describe("SKEL-U-01 negotiate", () => {
  test("prefers br, honours q-values and identity", () => {
    const both = { br: true, gz: true };
    expect(negotiate("gzip, deflate, br", both)).toBe("br");
    expect(negotiate("gzip;q=1, br;q=0.5", both)).toBe("gzip");
    expect(negotiate("br;q=0, gzip", both)).toBe("gzip");
    expect(negotiate("identity", both)).toBe("identity");
    expect(negotiate(null, both)).toBe("identity");
    expect(negotiate("*", both)).toBe("br");
    expect(negotiate("gzip", { br: true, gz: false })).toBe("identity");
    expect(negotiate("br, gzip", { br: false, gz: true })).toBe("gzip");
  });
});

describe("SRV-I-025 static serving (unit)", () => {
  test("index: br variant, no-cache, vary", async () => {
    const res = get("/", { "accept-encoding": "br, gzip" });
    expect(res?.headers.get("content-encoding")).toBe("br");
    expect(res?.headers.get("cache-control")).toBe("no-cache");
    expect(res?.headers.get("vary")).toBe("accept-encoding");
    expect(res?.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res?.text()).toBe("BR-HTML");
  });

  test("hashed assets are immutable; missing variants fall back to raw", async () => {
    const res = get("/assets/index-abc.js", { "accept-encoding": "gzip" });
    expect(res?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res?.headers.get("content-encoding")).toBeNull();
    expect(await res?.text()).toBe("console.log(1)");
    expect(get("/favicon.ico")?.headers.get("vary")).toBeNull();
  });

  test("SPA routes get the shell; unknown files and other methods do not", async () => {
    expect(await get("/doc")?.text()).toContain("<div id=app>");
    expect(await get("/ws/abc/doc/s/x")?.text()).toContain("<div id=app>");
    expect(get("/assets/missing.js")).toBeNull();
    expect(get("/../../etc/passwd.txt")).toBeNull();
    expect(get("/", {}, "POST")).toBeNull();
  });

  test("HEAD carries the headers without a body", async () => {
    const res = get("/", { "accept-encoding": "gzip" }, "HEAD");
    expect(res?.headers.get("content-encoding")).toBe("gzip");
    expect(await res?.text()).toBe("");
  });
});

describe("SRV-I-012 security headers", () => {
  test("every SECURITY_HEADERS entry; the head-inline placeholder becomes the inline script hashes", () => {
    const none = securityHeaders('<script type="module" src="/a.js"></script>');
    expect(Object.keys(none).sort()).toEqual(Object.keys(SECURITY_HEADERS).sort());
    expect(none["content-security-policy"]).toBe(SECURITY_HEADERS["content-security-policy"].replace(" 'sha256-{headInline}'", ""));
    const body = "document.documentElement.dataset.theme='dark'";
    const hash = new Bun.CryptoHasher("sha256").update(body).digest("base64");
    const one = securityHeaders(`<head><script>${body}</script><script type="module" src="/a.js"></script></head>`);
    expect(one["content-security-policy"]).toContain(`script-src 'self' 'sha256-${hash}';`);
  });
});
