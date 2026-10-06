import { afterAll, beforeAll, expect, test } from "bun:test";
import { PROVIDER_AUTH_IDS, type ProviderAuthId } from "@mitori/core";
import { type Harness, startHarness } from "../http/test/harness.ts";

let h: Harness;
let tab: Awaited<ReturnType<Harness["browser"]>>;
const opened: ProviderAuthId[] = [];
beforeAll(async () => {
  h = await startHarness({
    providerLogin: async (provider) => {
      opened.push(provider);
      return { opened: true };
    },
  });
  tab = await h.browser();
});
afterAll(() => h.close());

test("provider login forwards only the fixed enum from a browser session and returns dispatch state", async () => {
  for (const provider of PROVIDER_AUTH_IDS) {
    const res = await tab.req("POST", "/settings/provider-login", { provider });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ opened: true });
  }
  expect(opened).toEqual([...PROVIDER_AUTH_IDS]);
});

test("provider login rejects anonymous, CLI/MCP/bearer claiming web, cross-site, and arbitrary arguments before the port", async () => {
  const before = opened.length;
  expect((await h.req("POST", "/settings/provider-login", { body: { provider: "claude" } })).status).toBe(401);
  for (const client of ["cli/test", "mcp/test", "web/test", "hook/test"]) {
    const res = await h.req("POST", "/settings/provider-login", { bearer: h.token, body: { provider: "claude" }, headers: { "x-mitori-client": client } });
    expect([client, res.status]).toEqual([client, 403]);
    expect(await res.json()).toMatchObject({ error: { code: "E_FORBIDDEN" } });
  }
  const crossSite = await tab.req("POST", "/settings/provider-login", { provider: "claude" }, { "sec-fetch-site": "cross-site" });
  expect(crossSite.status).toBe(403);
  expect(await crossSite.json()).toMatchObject({ error: { code: "E_CSRF" } });
  for (const body of [
    {},
    { provider: "shell" },
    { provider: "claude;echo" },
    { provider: "claude", args: ["--dangerous"] },
    { provider: "muse", path: "/tmp/muse" },
    ["claude"],
  ]) {
    const res = await tab.req("POST", "/settings/provider-login", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "E_INVALID_INPUT" } });
  }
  expect(opened.length).toBe(before);
});

test("provider login without a host terminal port returns a copy-command fallback", async () => {
  const headless = await startHarness();
  try {
    const browser = await headless.browser();
    const res = await browser.req("POST", "/settings/provider-login", { provider: "codex" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ opened: false });
  } finally {
    await headless.close();
  }
});
