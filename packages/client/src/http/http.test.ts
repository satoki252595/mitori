import { describe, expect, test } from "bun:test";
import { MitoriError, ROUTE_META, type RouteKey } from "@mitori/core";
import { createApiClient } from "./index.ts";
import { probeDaemon } from "./probe.ts";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fakeFetch(respond: (seen: Seen) => Response) {
  const calls: Seen[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const seen: Seen = { url: String(input), method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : null };
    calls.push(seen);
    return respond(seen);
  }) as typeof fetch;
  return { f, calls };
}

describe("createApiClient", () => {
  test("response decoding matches every canonical route kind", async () => {
    const api = createApiClient({
      base: "/api/v1",
      auth: { scheme: "session", token: () => "t" },
      client: { kind: "web", version: "1" },
      fetch: (async () => new Response('"response"')) as unknown as typeof fetch,
    });
    for (const [route, meta] of Object.entries(ROUTE_META)) {
      const params = Object.fromEntries([...route.matchAll(/:([A-Za-z]+)/g)].map((m) => [m[1], "param"]));
      const result = api.call(route as RouteKey, { params } as never);
      if (meta.kind === "sse") await expect(result).rejects.toThrow("stream");
      else expect(await result).toBe(meta.kind === "text" || meta.kind === "download" ? '"response"' : "response");
    }
  });

  test("builds the request: encoded params, query, auth scheme, client header, idempotency, JSON body", async () => {
    const { f, calls } = fakeFetch(() => Response.json({ ok: true }));
    let token: string | null = "tok-1";
    const api = createApiClient({
      base: "http://127.0.0.1:4100/api/v1/",
      auth: { scheme: "session", token: () => token },
      client: { kind: "web", version: "0.1.0" },
      headers: { "x-mitori-agent": "claude-code" },
      fetch: f,
    });
    await api.call("POST /ws/:ws/doc/sections/:section/translate", {
      params: { ws: "ws_aaaaaaaaaaaa", section: "s3/auth flow" },
      body: { lang: "en" },
      idempotencyKey: "k1",
    });
    expect(calls[0]).toEqual({
      url: "http://127.0.0.1:4100/api/v1/ws/ws_aaaaaaaaaaaa/doc/sections/s3%2Fauth%20flow/translate",
      method: "POST",
      headers: {
        authorization: "Mitori-Session tok-1",
        "content-type": "application/json",
        "idempotency-key": "k1",
        "x-mitori-agent": "claude-code",
        "x-mitori-client": "web/0.1.0",
      },
      body: '{"lang":"en"}',
    });
    token = null;
    await api.call("GET /ws/:ws/symbols", { params: { ws: "ws_aaaaaaaaaaaa" }, query: { q: "Login", limit: 5, path: undefined } as never });
    expect(calls[1]?.url).toBe("http://127.0.0.1:4100/api/v1/ws/ws_aaaaaaaaaaaa/symbols?q=Login&limit=5");
    expect(calls[1]?.headers.authorization).toBeUndefined();
    expect(calls[1]?.headers["content-type"]).toBeUndefined();
    const bearer = createApiClient({ base: "http://x/api/v1", auth: { scheme: "bearer", token: () => "B" }, client: { kind: "cli", version: "1" }, fetch: f });
    await bearer.call("GET /health", { params: {} });
    expect(calls[2]?.headers.authorization).toBe("Bearer B");
  });

  test("x-mitori-rev reaches onRev before the promise resolves; text routes return text", async () => {
    const { f } = fakeFetch((s) =>
      s.url.includes("/doc/text")
        ? new Response("# doc", { headers: { "x-mitori-rev": "7" } })
        : Response.json({ id: "th_1" }, { headers: { "x-mitori-rev": "42" } }),
    );
    const api = createApiClient({ base: "/api/v1", auth: { scheme: "session", token: () => "t" }, client: { kind: "web", version: "1" }, fetch: f });
    const order: string[] = [];
    const res = await api.call("POST /ws/:ws/threads", {
      params: { ws: "ws_aaaaaaaaaaaa" },
      body: {} as never,
      onRev: (rev) => order.push(`rev:${rev}`),
    });
    order.push("resolved");
    expect(order).toEqual(["rev:42", "resolved"]);
    expect(res).toEqual({ id: "th_1" } as never);
    expect(await api.call("GET /ws/:ws/doc/text", { params: { ws: "ws_aaaaaaaaaaaa" }, query: { ref: "*" } })).toBe("# doc");
  });

  test("errors: ApiErrorBody ⇒ MitoriError (estimate kept); other bodies ⇒ E_INTERNAL; network ⇒ E_NOT_READY; missing param ⇒ E_INVALID_INPUT", async () => {
    const estimate = { id: "es_0000000001", apiUsd: 0.3 };
    const { f } = fakeFetch((s) => {
      if (s.url.endsWith("/jobs"))
        return Response.json({ error: { code: "E_CONFLICT", message: "estimate drifted", retryable: true }, estimate }, { status: 409 });
      return new Response("<html>gateway</html>", { status: 502 });
    });
    const api = createApiClient({ base: "/api/v1", auth: { scheme: "session", token: () => "t" }, client: { kind: "web", version: "1" }, fetch: f });
    const e1 = await api.call("POST /ws/:ws/jobs", { params: { ws: "ws_aaaaaaaaaaaa" }, body: {} as never }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(e1).toBeInstanceOf(MitoriError);
    expect((e1 as MitoriError).code).toBe("E_CONFLICT");
    expect((e1 as MitoriError & { estimate?: unknown }).estimate).toEqual(estimate);
    const e2 = await api.call("GET /workspaces", { params: {} }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((e2 as MitoriError).code).toBe("E_INTERNAL");
    const down = createApiClient({
      base: "/api/v1",
      auth: { scheme: "session", token: () => "t" },
      client: { kind: "web", version: "1" },
      fetch: (() => Promise.reject(new TypeError("connection refused"))) as unknown as typeof fetch,
    });
    expect(
      await down.call("GET /workspaces", { params: {} }).then(
        () => null,
        (e: MitoriError) => e.code,
      ),
    ).toBe("E_NOT_READY");
    await expect(api.call("GET /ws/:ws", { params: { ws: "" as never } })).rejects.toThrow("missing path param ws");
    await expect(api.call("GET /events", { params: {} })).rejects.toThrow("stream");
  });
});

describe("SRV-I-028 / SRV-AT-09 health challenge (CLI side)", () => {
  const challenge = new Uint8Array(16).map((_, i) => i * 7);
  const hex = Array.from(challenge, (b) => b.toString(16).padStart(2, "0")).join("");

  test("a fake listener with a wrong proof gets null and never sees the token", async () => {
    const seenAuth: (string | null)[] = [];
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        seenAuth.push(req.headers.get("authorization"));
        return Response.json({ ok: true, version: "0.1.0", apiVersion: 1, pid: 1, startedAt: "x", build: "release", proof: "0".repeat(64) });
      },
    });
    try {
      const origin = `http://127.0.0.1:${fake.port}`;
      expect(await probeDaemon({ origin, token: "secret-token", challenge })).toBeNull();
      expect(seenAuth).toEqual([null]);
    } finally {
      await fake.stop(true);
    }
  });

  test("the real proof is accepted; a silent or non-mitori listener is rejected", async () => {
    const token = "real-token";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const proof = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(hex))), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    const ok = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        const c = new URL(req.url).searchParams.get("challenge");
        return Response.json({ ok: true, version: "0.1.0", apiVersion: 1, pid: 1, startedAt: "x", build: "test", ...(c === hex ? { proof } : {}) });
      },
    });
    const silent = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => undefined) });
    const html = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("<html>") });
    try {
      expect((await probeDaemon({ origin: `http://127.0.0.1:${ok.port}`, token, challenge }))?.build).toBe("test");
      expect(await probeDaemon({ origin: `http://127.0.0.1:${ok.port}`, token: "other", challenge })).toBeNull();
      const t0 = performance.now();
      expect(await probeDaemon({ origin: `http://127.0.0.1:${silent.port}`, token, challenge, timeoutMs: 100 })).toBeNull();
      expect(performance.now() - t0).toBeLessThan(1000);
      expect(await probeDaemon({ origin: `http://127.0.0.1:${html.port}`, token, challenge })).toBeNull();
      expect(await probeDaemon({ origin: "http://127.0.0.1:1", token, challenge })).toBeNull();
    } finally {
      await Promise.all([ok.stop(true), silent.stop(true), html.stop(true)]);
    }
  });
});
