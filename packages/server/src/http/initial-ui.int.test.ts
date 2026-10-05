import { expect, test } from "bun:test";
import { API_PREFIX, type GenEstimate, type InitialUiRenderer, type InitialUiSnapshot } from "@mitori/core";
import { startHarness } from "./test/harness.ts";

test("large initial UI negotiates compressed bytes without changing its authenticated DTO", async () => {
  const html = "<main>read</main>".repeat(1024);
  const h = await startHarness({ uiRenderer: async () => ({ html, snapshot: {} as InitialUiSnapshot }) });
  try {
    const ws = await h.openProject();
    const b = await h.browser();
    const path = `/ws/${ws}/ui?url=${encodeURIComponent(`/w/${ws}`)}`;
    for (const [accept, encoding] of [
      ["br, gzip", "br"],
      ["gzip", "gzip"],
      ["br;q=0, gzip;q=0", null],
    ] as const) {
      const res = await b.req("GET", path, undefined, { "accept-encoding": accept });
      expect(res.headers.get("content-encoding")).toBe(encoding);
      expect(res.headers.get("vary")).toBe("accept-encoding");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await res.json()).html).toBe(html);
    }
  } finally {
    await h.close();
  }
});

test("initial UI keeps authentication, CSRF, workspace and no-store gates before rendering", async () => {
  let calls = 0;
  const render: InitialUiRenderer = async (query, get) => {
    calls++;
    return { html: "<main>read</main>", snapshot: (await get(query.get("read") ?? "/settings")) as InitialUiSnapshot };
  };
  const h = await startHarness({ uiRenderer: render });
  try {
    const ws = await h.openProject();
    const b = await h.browser();
    const path = `/ws/${ws}/ui?url=${encodeURIComponent(`/w/${ws}`)}`;
    expect((await h.req("GET", path)).status).toBe(401);
    expect((await b.req("GET", path, undefined, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await b.req("GET", `/ws/ws_000000000000/ui?url=/w/ws_000000000000`)).status).toBe(404);
    expect(calls).toBe(0);
    const res = await b.req("GET", path, undefined, { "accept-encoding": "gzip, br" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const body = await res.json();
    expect(body.html).toBe("<main>read</main>");
    expect(body.snapshot).toEqual(await (await b.req("GET", "/settings")).json());
    expect(calls).toBe(1);
  } finally {
    await h.close();
  }
});

test("initial UI estimates use only the fixed dry route with the caller's authentication and CSRF gates", async () => {
  const calls: unknown[] = [];
  const h = await startHarness({
    handlers: {
      "POST /ws/:ws/gen/estimate": async (ctx) => {
        calls.push({ ws: ctx.ws, body: ctx.body, client: ctx.auth.client, idempotency: ctx.req.headers.get("idempotency-key") });
        return { id: "dry" } as unknown as GenEstimate;
      },
      "POST /ws/:ws/gen/runs": async () => {
        throw new Error("generation must never be started by SSR");
      },
    },
    uiRenderer: async (_query, _get, estimate) => ({ html: String((await estimate("standard", "generic")).id), snapshot: {} as InitialUiSnapshot }),
  });
  try {
    const ws = await h.openProject();
    const b = await h.browser();
    const path = `/ws/${ws}/ui?url=${encodeURIComponent(`/w/${ws}`)}`;
    expect((await h.req("GET", path)).status).toBe(401);
    expect(calls).toEqual([]);
    const res = await b.req("GET", path, undefined, { "accept-encoding": "gzip", "idempotency-key": "outer-key" });
    expect(res.status).toBe(200);
    expect((await res.json()).html).toBe("dry");
    expect(calls).toEqual([{ ws, body: { effort: "standard", engine: "generic" }, client: "web", idempotency: null }]);
    // The outer GET can be same-site, but its internal POST must still obey the stricter POST CSRF rule.
    expect((await b.req("GET", path, undefined, { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect(calls).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("initial UI internal reads cannot cross workspace, recurse, stream, mutate or read arbitrary files", async () => {
  const proposalReads: unknown[] = [];
  const h = await startHarness({
    handlers: {
      "GET /ws/:ws/doc/proposals": async (ctx) => {
        proposalReads.push({ ws: ctx.ws, client: ctx.auth.client });
        return [];
      },
    },
    uiRenderer: async (query, get) => ({ html: "<main>read</main>", snapshot: (await get(query.get("read") ?? "/settings")) as InitialUiSnapshot }),
  });
  try {
    const ws = await h.openProject();
    const other = await h.openProject("other");
    const b = await h.browser();
    const base = `/ws/${ws}/ui?url=${encodeURIComponent(`/w/${ws}/doc/s1`)}`;
    const proposals = await b.req("GET", `${base}&read=${encodeURIComponent(`/ws/${ws}/doc/proposals?state=pending`)}`);
    expect(proposals.status).toBe(200);
    expect((await proposals.json()).snapshot).toEqual([]);
    expect(proposalReads).toEqual([{ ws, client: "web" }]);
    for (const path of [
      `/ws/${other}`,
      `/ws/${other}/doc`,
      `/ws/${other}/doc/proposals`,
      `/ws/${ws}/doc/proposals/pp_00000000/accept`,
      `/ws/${ws}/ui`,
      `/ws/${ws}/files/content?path=secret.txt`,
      "/events",
      "/auth/nonce",
      "/workspaces",
      `/usage/summary?range=all&ws=${other}`,
      "//evil.example/settings",
      "https://evil.example/settings",
      "/settings#fragment",
      "/settings\\extra",
    ])
      expect([path, (await b.req("GET", `${base}&read=${encodeURIComponent(path)}`)).status]).toEqual([path, 403]);
    expect(proposalReads).toHaveLength(1);
    for (const target of [`/w/${other}`, `/w/${ws}/code/a.ts`, "//evil.example/w", "https://evil.example/w", `/w\\${ws}`]) {
      const res = await b.req("GET", `/ws/${ws}/ui?url=${encodeURIComponent(target)}`);
      expect([400, 403]).toContain(res.status);
    }
    // Bun refuses this URL as 431 before fetch; exercise the app guard directly too.
    const oversized = new Request(`${h.origin}${API_PREFIX}${base}&ui=${"x".repeat(65_536)}`, {
      headers: { host: new URL(h.origin).host, authorization: `Mitori-Session ${b.token}`, "sec-fetch-site": "same-origin" },
    });
    expect((await h.daemon.app.fetch(oversized)).status).toBe(413);
  } finally {
    await h.close();
  }
});
