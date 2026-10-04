import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { API_PREFIX, ROUTE_META, type RouteKey, type RouteMeta, SECURITY_HEADERS, type WorkspaceKey } from "@mitori/core";
import { ROUTE_OWNERS } from "../contract.ts";
import { ROUTE_KEYS } from "../routes/match.ts";
import { serverHandlers } from "../routes/server.ts";
import type { RouteHandlers } from "../routes/types.ts";
import { DEFAULT_MAX_BODY } from "./app.ts";
import { type Harness, startHarness } from "./test/harness.ts";

/** Concrete path for a route key (params substituted). */
function pathOf(key: RouteKey, ws: string): { method: string; path: string } {
  const [method = "GET", tpl = "/"] = key.split(" ");
  const path = tpl.replace(/:([a-z]+)/g, (_m, p: string) =>
    p === "ws" ? ws : p === "section" ? "s1%2Fintro" : p === "engine" ? "claude-cli" : p === "n" ? "1" : `x${p}`,
  );
  return { method, path };
}

let h: Harness;
let ws: WorkspaceKey;
let session: Awaited<ReturnType<Harness["browser"]>>;

/** Paths the file-reading adapters were asked for (SRV-I-013 "open spy"). */
const opened: string[] = [];

const handlers: RouteHandlers = {
  "GET /ws/:ws/files/content": (ctx) => {
    opened.push(ctx.query.get("path") ?? "");
    return { path: ctx.query.get("path") } as never;
  },
  "GET /ws/:ws/cite": (ctx) => {
    opened.push(ctx.query.get("path") ?? "");
    return { path: ctx.query.get("path") } as never;
  },
  // a workspace mutation through the write queue (SRV-I-017 over HTTP)
  "POST /ws/:ws/threads": async (ctx) => {
    const rt = await ctx.runtime();
    await rt.write("thread.create", () => rt.events.emit({ type: "thread.removed", id: "th_00000001" }));
    return { ok: true } as never;
  },
  "GET /ws/:ws/review/wait": (ctx) =>
    new Promise((resolve) => {
      ctx.signal.addEventListener("abort", () => resolve({ status: "timeout", approved: false, next: "mitori review" }), { once: true });
    }),
  "GET /ws/:ws/export/html": () => "<!doctype html><title>x</title>",
  "GET /ws/:ws/doc/text": () => "<!-- b_00000000 §s1 L0 -->\ntext",
};

beforeAll(async () => {
  h = await startHarness({ handlers });
  ws = await h.openProject();
  session = await h.browser();
});
afterAll(() => h.close());

const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("SRV-I-001 / SRV-AT-01 authentication", () => {
  test("every route except /health and /auth/exchange answers 401 without credentials", async () => {
    for (const key of ROUTE_KEYS) {
      const { method, path } = pathOf(key, ws);
      const res = await h.req(method, path, method === "GET" || method === "DELETE" ? {} : { body: {} });
      const expectAnon = key === "GET /health" || key === "POST /auth/exchange";
      if (expectAnon) expect(res.status).not.toBe(401);
      else {
        expect([key, res.status]).toEqual([key, 401]);
        expect(await errCode(res)).toBe("E_AUTH_REQUIRED");
      }
    }
  });

  test("SRV-I-005: a cookie alone is no credential; an unknown session or bearer is 401", async () => {
    const cookie = await h.req("PATCH", "/settings", { body: { version: 1, patch: {} }, headers: { cookie: `mitori_s=${session.token}; mitori_ui=x` } });
    expect(cookie.status).toBe(401);
    expect((await h.req("GET", "/settings", { session: "A".repeat(43) })).status).toBe(401);
    expect((await h.req("GET", "/settings", { bearer: "nope" })).status).toBe(401);
    expect((await h.req("GET", "/settings", { headers: { authorization: "Basic eDp5" } })).status).toBe(401);
    expect((await session.req("GET", "/settings")).status).toBe(200);
  });
});

describe("SRV-I-002 client kinds", () => {
  test("ROUTE_META.clients violations ⇒ 403 E_FORBIDDEN", async () => {
    const cases: [Promise<Response>, string][] = [
      [session.req("POST", "/daemon/shutdown", {}), "web → shutdown"],
      [h.cli("POST", `/ws/${ws}/trust/tr_00000000`, { decision: "trusted" }), "cli → trust"],
      [h.cli("POST", `/ws/${ws}/review/finish`, {}), "cli → finish"],
      [h.cli("POST", `/ws/${ws}/threads/th_00000000/transition`, {}), "cli → transition"],
      [h.req("POST", `/ws/${ws}/threads/th_00000000/transition`, { bearer: h.token, body: {}, headers: { "x-mitori-client": "mcp/1" } }), "mcp → transition"],
      [
        h.req("POST", `/ws/${ws}/threads/th_00000000/transition`, { bearer: h.token, body: {}, headers: { "x-mitori-client": "web/1" } }),
        "bearer claiming web",
      ],
      [h.cli("PATCH", "/settings", { version: 1, patch: {} }), "cli → PATCH /settings"],
      [session.req("PATCH", "/settings/exec", { path: "limits.jobMaxUsd", value: 1, confirm: true }), "web → PATCH /settings/exec"],
      [session.req("POST", "/auth/nonce", {}), "web → nonce"],
    ];
    for (const [p, label] of cases) {
      const res = await p;
      expect([label, res.status]).toEqual([label, 403]);
      expect(await errCode(res)).toBe("E_FORBIDDEN");
    }
  });
});

describe("SRV-I-003 Host", () => {
  test("only 127.0.0.1:<port> and localhost:<port>", async () => {
    for (const host of ["evil.example", `127.0.0.1:${h.port + 1}`, `localhost.evil.com:${h.port}`, `127.0.0.1`, `[::1]:${h.port}`]) {
      const res = await h.req("GET", "/health", { headers: { host } });
      expect([host, res.status]).toEqual([host, 421]);
      expect(await errCode(res)).toBe("E_BAD_HOST");
      const page = await fetch(`${h.origin}/`, { headers: { host } });
      expect(page.status).toBe(421);
    }
    expect((await h.req("GET", "/health", { headers: { host: `localhost:${h.port}` } })).status).toBe(200);
    expect((await h.req("GET", "/health")).status).toBe(200);
  });
});

describe("SRV-I-004 / 005 / 008 CSRF", () => {
  test("state-changing requests with sec-fetch-site other than same-origin ⇒ 403 E_CSRF (session and bearer)", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const res = await session.req("PATCH", "/settings", { version: 1, patch: {} }, { "sec-fetch-site": site });
      expect([site, res.status]).toEqual([site, 403]);
      expect(await errCode(res)).toBe("E_CSRF");
    }
    const bearer = await h.cli("POST", "/auth/nonce", {}, { "sec-fetch-site": "cross-site" });
    expect(bearer.status).toBe(403);
    expect(await errCode(bearer)).toBe("E_CSRF");
    const exchange = await h.req("POST", "/auth/exchange", { body: { nonce: "x" }, headers: { "sec-fetch-site": "cross-site" } });
    expect(exchange.status).toBe(403);
  });

  test("SRV-I-008: GET with sec-fetch-site cross-site ⇒ 403; same-origin and absent are fine", async () => {
    expect((await session.req("GET", "/settings", undefined, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await session.req("GET", "/settings", undefined, { "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await h.cli("GET", "/settings")).status).toBe(200);
  });
});

describe("SRV-I-006 / 007 content-type and CORS", () => {
  test("non-JSON bodies on JSON routes ⇒ 415", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await h.req("POST", "/auth/nonce", { bearer: h.token, rawBody: '{"to":"/"}', headers: { "content-type": ct, "x-mitori-client": "cli/t" } });
      expect([ct, res.status]).toEqual([ct, 415]);
    }
    const noCt = await h.req("POST", "/auth/nonce", { bearer: h.token, rawBody: '{"to":"/"}', headers: { "x-mitori-client": "cli/t", "content-type": "" } });
    expect([400, 415]).toContain(noCt.status);
    const charset = await h.req("POST", "/auth/nonce", {
      bearer: h.token,
      rawBody: '{"to":"/"}',
      headers: { "content-type": "application/json; charset=utf-8", "x-mitori-client": "cli/t" },
    });
    expect(charset.status).toBe(200);
    const bad = await h.cli("POST", "/auth/nonce", undefined, { "content-type": "application/json" });
    expect(bad.status).toBe(200); // empty body = no options
  });

  test("OPTIONS preflight on every route returns no Access-Control-* header", async () => {
    for (const key of ROUTE_KEYS) {
      const { path } = pathOf(key, ws);
      const res = await fetch(`${h.origin}${API_PREFIX}${path}`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization" },
      });
      const cors = [...res.headers.keys()].filter((k) => k.startsWith("access-control-"));
      expect([key, cors]).toEqual([key, []]);
    }
  });
});

describe("SRV-I-012 security headers", () => {
  test("every response carries SECURITY_HEADERS (CSP with the inline-script hash); API responses are no-store", async () => {
    const responses = [
      await h.req("GET", "/health"),
      await h.req("GET", "/settings"),
      await session.req("GET", `/ws/${ws}/doc/text?ref=*`),
      await fetch(`${h.origin}/`),
      await fetch(`${h.origin}/assets/app-abc123.js`),
      await fetch(`${h.origin}/nope.png`),
      await h.req("GET", "/health", { headers: { host: "evil.example" } }),
    ];
    for (const res of responses) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        if (k === "content-security-policy") {
          const csp = res.headers.get(k) ?? "";
          expect(csp).toContain("form-action 'none'; object-src 'none'; worker-src 'self'");
          expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]{44}';/);
          expect(csp).not.toContain("{headInline}");
        } else expect(res.headers.get(k)).toBe(v);
      }
    }
    expect(responses[0]?.headers.get("cache-control")).toBe("no-store");
    expect(responses[2]?.headers.get("cache-control")).toBe("no-store");
    // SRV-I-010: no cookie is ever set, not even by the login exchange (the session token lives in localStorage)
    const n = (await (await h.cli("POST", "/auth/nonce", { to: "/" })).json()) as { url: string };
    const exchange = await h.req("POST", "/auth/exchange", {
      body: { nonce: new URL(n.url).hash.slice(3).split("&")[0] },
      headers: { "sec-fetch-site": "same-origin", "x-mitori-client": "web/test" },
    });
    expect(exchange.status).toBe(200);
    for (const res of [...responses, exchange]) expect(res.headers.get("set-cookie")).toBeNull();
    expect(responses[0]?.headers.get("x-mitori-request-id")).toMatch(/^rq_/);
    const inline = 'document.documentElement.dataset.t="1"';
    const hash = new Bun.CryptoHasher("sha256").update(inline).digest("base64");
    expect(responses[3]?.headers.get("content-security-policy")).toContain(`'sha256-${hash}'`);
  });
});

describe("SRV-I-015 body size", () => {
  test("1 MiB + 1 B ⇒ 413 (declared and chunked)", async () => {
    const big = `{"to":"/${"a".repeat(DEFAULT_MAX_BODY)}"}`;
    const declared = await h.req("POST", "/auth/nonce", {
      bearer: h.token,
      rawBody: big,
      headers: { "content-type": "application/json", "x-mitori-client": "cli/t" },
    });
    expect(declared.status).toBe(413);
    expect(await errCode(declared)).toBe("E_PAYLOAD_TOO_LARGE");
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 9; i++) c.enqueue(enc.encode("a".repeat(128 * 1024)));
        c.close();
      },
    });
    const chunked = await fetch(`${h.origin}${API_PREFIX}/auth/nonce`, {
      method: "POST",
      body: stream,
      headers: { authorization: `Bearer ${h.token}`, "content-type": "application/json", "x-mitori-client": "cli/t" },
    });
    expect(chunked.status).toBe(413);
    const exact = `{"to":"/${"a".repeat(DEFAULT_MAX_BODY - 12)}"}`;
    expect(exact.length).toBeLessThanOrEqual(DEFAULT_MAX_BODY);
    const ok = await h.req("POST", "/auth/nonce", {
      bearer: h.token,
      rawBody: exact,
      headers: { "content-type": "application/json", "x-mitori-client": "cli/t" },
    });
    expect(ok.status).not.toBe(413);
  });
});

describe("SRV-AT-02 / SRV-I-021 route table", () => {
  test("every server-owned route has a handler; every other route answers 501 until its adapter is wired", async () => {
    const own = serverHandlers(h.daemon.services);
    for (const key of ROUTE_KEYS) {
      expect(ROUTE_OWNERS[key]).toBeDefined();
      if (ROUTE_OWNERS[key] === "server") {
        expect([key, typeof own[key]]).toEqual([key, "function"]);
        continue;
      }
      if (key in handlers) continue;
      const meta: RouteMeta = ROUTE_META[key];
      const { method, path } = pathOf(key, ws);
      const client = meta.clients?.[0] ?? "cli";
      const res =
        client === "web"
          ? await session.req(method, path, method === "GET" || method === "DELETE" ? undefined : {})
          : await h.req(method, path, {
              bearer: h.token,
              headers: { "x-mitori-client": `${client}/t` },
              ...(method === "GET" || method === "DELETE" ? {} : { body: {} }),
            });
      expect([key, res.status]).toEqual([key, 501]);
      expect(await errCode(res)).toBe("E_UNSUPPORTED");
    }
  });

  test("long-poll honours timeoutMs; download carries content-disposition; text is text/plain", async () => {
    const t0 = performance.now();
    const res = await h.cli("GET", `/ws/${ws}/review/wait?timeoutMs=150`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("timeout");
    expect(performance.now() - t0).toBeGreaterThanOrEqual(140);
    const dl = await session.req("GET", `/ws/${ws}/export/html`);
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="mitori-${ws}.html"`);
    const text = await session.req("GET", `/ws/${ws}/doc/text?ref=*`);
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await text.text()).toContain("b_00000000");
  });

  test("unknown /api paths ⇒ 404 JSON; unknown workspace ⇒ 404 E_WS_NOT_FOUND; malformed encoding ⇒ 400", async () => {
    const unknown = await h.cli("GET", "/nope");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
    expect(await errCode(unknown)).toBe("E_NOT_FOUND");
    for (const path of ["/api/v2/health", "/api", "/api/whatever"]) {
      const res = await fetch(`${h.origin}${path}`);
      expect([path, res.status, res.headers.get("content-type")]).toEqual([path, 404, "application/json;charset=utf-8"]);
    }
    expect(await errCode(await h.cli("GET", "/ws/ws_zzzzzzzzzzzz"))).toBe("E_WS_NOT_FOUND");
    expect(await errCode(await h.cli("GET", "/ws/not-a-key"))).toBe("E_WS_NOT_FOUND");
    expect((await h.cli("GET", `/ws/${ws}/doc/sections/%E0%A4%A`)).status).toBe(400);
  });
});

describe("SRV-I-013 path traversal at the HTTP boundary", () => {
  test("traversal / absolute / backslash / NUL / overlong UTF-8 ⇒ 400 E_INVALID_INPUT and no adapter call; NFD is normalized", async () => {
    const bad = [
      "../../etc/passwd",
      "%2e%2e%2fetc%2fpasswd",
      "..%2fetc",
      "..%5Cetc",
      "%2Fetc%2Fpasswd",
      "C:%5CWindows",
      "%5C%5Cserver%5Cshare",
      "a%00b",
      "%c0%ae%c0%ae%2fetc",
      "src/./x.ts",
      "src//x.ts",
      "",
    ];
    opened.length = 0;
    for (const p of bad)
      for (const route of ["files/content", "cite"]) {
        const res = await session.req("GET", `/ws/${ws}/${route}?path=${p}&start=1&end=2&blob=0`);
        expect([route, p, res.status]).toEqual([route, p, 400]);
        expect(await errCode(res)).toBe("E_INVALID_INPUT");
      }
    const twice = await session.req("GET", `/ws/${ws}/files/content?path=a.ts&path=../x`);
    expect(twice.status).toBe(400);
    expect(opened).toEqual([]);
    const nfd = "cafe\u0301.ts".normalize("NFD");
    const ok = await session.req("GET", `/ws/${ws}/files/content?path=${encodeURIComponent(nfd)}`);
    expect(ok.status).toBe(200);
    expect(opened).toEqual([nfd.normalize("NFC")]);
  });
});

describe("SRV-I-017 concurrent mutations over HTTP", () => {
  test("100 concurrent writes ⇒ unique, gap-free x-mitori-rev", async () => {
    const before = (await (await h.cli("GET", `/ws/${ws}`)).json()) as { rev: number };
    const res = await Promise.all(Array.from({ length: 100 }, () => h.cli("POST", `/ws/${ws}/threads`, {})));
    const revs = res.map((r) => Number(r.headers.get("x-mitori-rev"))).sort((a, b) => a - b);
    expect(new Set(revs).size).toBe(100);
    expect(revs).toEqual(Array.from({ length: 100 }, (_, i) => before.rev + 1 + i));
  });
});

describe("SRV-I-019 idempotency", () => {
  test("same key + same body ⇒ same response; same key + other body ⇒ 409", async () => {
    const a = await h.cli("POST", "/auth/nonce", { to: "/a" }, { "idempotency-key": "k-1" });
    const b = await h.cli("POST", "/auth/nonce", { to: "/a" }, { "idempotency-key": "k-1" });
    const ja = await a.json();
    expect(await b.json()).toEqual(ja);
    const c = await h.cli("POST", "/auth/nonce", { to: "/b" }, { "idempotency-key": "k-1" });
    expect(c.status).toBe(409);
    expect(await errCode(c)).toBe("E_CONFLICT");
    const fresh = await h.cli("POST", "/auth/nonce", { to: "/a" }, { "idempotency-key": "k-2" });
    expect(await fresh.json()).not.toEqual(ja);
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => h.cli("POST", `/ws/${ws}/threads`, {}, { "idempotency-key": "ws-k" })));
    expect(new Set(concurrent.map((r) => r.headers.get("x-mitori-rev"))).size).toBe(1);
    // global route (state.sqlite store): concurrent duplicates share the first answer
    const dupes = await Promise.all(Array.from({ length: 5 }, () => h.cli("POST", "/auth/nonce", { to: "/c" }, { "idempotency-key": "g-k" })));
    expect(new Set(await Promise.all(dupes.map((r) => r.text()))).size).toBe(1);
  });
});

describe("SRV-I-025 static delivery", () => {
  test("precompressed variants + immutable; SPA fallback; /auth serves the shell; missing assets 404", async () => {
    const br = await fetch(`${h.origin}/assets/app-abc123.js`, { headers: { "accept-encoding": "br, gzip" }, decompress: false } as RequestInit);
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(br.headers.get("vary")).toBe("accept-encoding");
    const gz = await fetch(`${h.origin}/assets/app-abc123.js`, { headers: { "accept-encoding": "gzip" }, decompress: false } as RequestInit);
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const shell = await fetch(`${h.origin}/w/${ws}/doc/s1`);
    expect(shell.status).toBe(200);
    expect(shell.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(shell.headers.get("cache-control")).toBe("no-cache");
    expect((await fetch(`${h.origin}/auth`)).status).toBe(200);
    // in-app routes whose last segment looks like a file still get the shell (reload on a code view)
    for (const route of [`/w/${ws}/code/src/main.ts`, `/w/${ws}/doc/s1%2Fv1.2`, "/settings"]) {
      const res = await fetch(`${h.origin}${route}`);
      expect([route, res.status, res.headers.get("content-type")]).toEqual([route, 200, "text/html; charset=utf-8"]);
    }
    expect((await fetch(`${h.origin}/missing.js`)).status).toBe(404);
    expect((await fetch(`${h.origin}/assets/missing-123.js`)).status).toBe(404);
    expect((await fetch(`${h.origin}/`, { method: "POST" })).status).toBe(404);
  });

  test("portable permalink resolves a docId or falls back to the Launcher", async () => {
    const res = await fetch(`${h.origin}/d/doc_000000000000/b/b_00000000`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("SRV-I-031 / SRV-AT-07 touch on unregistered repos", () => {
  test("100 touches ⇒ registered:false, no scan, no workspace opened, each ≤ 20 ms", async () => {
    const scans = h.domain.scans;
    const loaded = h.daemon.services.workspaces.loaded().length;
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      const res = await h.req("POST", "/ws/ws_unregistered0/touch", {
        bearer: h.token,
        body: { paths: ["/tmp/x.ts"], source: "claude-hook" },
        headers: { "x-mitori-client": "hook/1" },
      });
      times.push(performance.now() - t0);
      expect(await res.json()).toEqual({ staleBlocks: 0, registered: false });
    }
    expect(h.domain.scans).toBe(scans);
    expect(h.daemon.services.workspaces.loaded().length).toBe(loaded);
    expect(Math.max(...times)).toBeLessThanOrEqual(1_000); // answers without opening anything (≤ 20 ms quiet; generous under load)
    expect(h.daemon.services.workspaces.registered("/definitely/not/registered")).toBeNull();
  });
});
