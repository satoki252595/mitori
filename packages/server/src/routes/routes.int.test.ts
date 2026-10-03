import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DaemonStatus, InboxItem, Page, SettingsView, TrustRecord, TrustRequest, WorkspaceKey, WorkspaceStatus, WorkspaceSummary } from "@mitori/core";
import { type Harness, startHarness } from "../http/test/harness.ts";

let h: Harness;
let ws: WorkspaceKey;
/** Wall clock that the trust test can move forward (sessions age with it). */
const skew = { ms: 0 };
const clock = { now: () => Date.now() + skew.ms, iso: () => new Date(Date.now() + skew.ms).toISOString() };
let tab: Awaited<ReturnType<Harness["browser"]>>;

const json = async <T>(res: Response | Promise<Response>): Promise<T> => (await (await res).json()) as T;

beforeAll(async () => {
  const now = new Date().toISOString();
  h = await startHarness({
    clock,
    domain: {
      inbox: () => ({
        loop: Array.from({ length: 5 }, (_, i) => ({
          kind: "thread" as const,
          id: `th_0000000${i}`,
          title: `t${i}`,
          state: "answered",
          tags: [],
          updatedAt: now,
          href: `/w/x/threads/th_0000000${i}`,
        })),
        proposals: [],
        genRuns: [],
        suggestions: [],
      }),
    },
  });
  ws = await h.openProject();
  tab = await h.browser();
});
afterAll(() => h.close());

describe("server-owned routes", () => {
  test("GET /daemon and GET /workspaces", async () => {
    const d = await json<DaemonStatus>(h.cli("GET", "/daemon"));
    expect(d).toMatchObject({ pid: process.pid, port: h.port, workspaces: [ws] });
    expect(d.rssMb).toBeGreaterThan(0);
    const list = await json<WorkspaceSummary[]>(h.cli("GET", "/workspaces"));
    expect(list.map((w) => w.info.key)).toEqual([ws]);
  });

  test("GET /ws/:ws: status from runtime + services (connectedTabs counts web SSE streams)", async () => {
    await Bun.sleep(10);
    const s = await json<WorkspaceStatus>(tab.req("GET", `/ws/${ws}`));
    expect(s).toMatchObject({ state: "ready", trustPending: 0, connectedTabs: 0, counts: { files: 3 }, notices: [] });
    expect(typeof s.rev).toBe("number");
  });

  test("PATCH /ws/:ws/settings rewrites the overrides and re-resolves", async () => {
    const eff = await json<{ overrides: { readerLevel?: string } }>(tab.req("PATCH", `/ws/${ws}/settings`, { overrides: { readerLevel: "expert" } }));
    expect(eff.overrides).toEqual({ readerLevel: "expert" });
    const view = await json<SettingsView>(h.cli("GET", "/settings"));
    expect(view.settings.workspaces[ws]).toEqual({ readerLevel: "expert" });
    const bad = await tab.req("PATCH", `/ws/${ws}/settings`, { overrides: { docDir: "../x" } });
    expect(bad.status).toBe(400);
  });

  test("trust over HTTP: list, 60 s session rule, decision", async () => {
    const id = h.daemon.services.trust.request(ws, "rules", "c".repeat(64), "AGENTS.md");
    const list = await json<TrustRequest[]>(tab.req("GET", `/ws/${ws}/trust`));
    expect(list.map((r) => r.id)).toContain(id);
    const young = await tab.req("POST", `/ws/${ws}/trust/${id}`, { decision: "trusted" });
    expect(young.status).toBe(403);
    expect(((await young.json()) as { error: { code: string } }).error.code).toBe("E_FORBIDDEN");
    const other = await tab.req("POST", `/ws/${ws}/trust/tr_zzzzzzzz`, { decision: "trusted" });
    expect(other.status).toBe(404);
    const bad = await tab.req("POST", `/ws/${ws}/trust/${id}`, { decision: "maybe" });
    expect(bad.status).toBe(400);
    expect((await json<WorkspaceStatus>(tab.req("GET", `/ws/${ws}`))).trustPending).toBe(1);
    skew.ms += 61_000; // the same session, now older than 60 s
    const rec = await json<TrustRecord>(tab.req("POST", `/ws/${ws}/trust/${id}`, { decision: "denied" }));
    expect(rec).toMatchObject({ id, decision: "denied", item: "rules" });
  });

  test("GET /ws/:ws/inbox: domain rows + trust rows, filter, pagination with cursor", async () => {
    const id = h.daemon.services.trust.request(ws, "gates", "d".repeat(64), "make test");
    const first = await json<Page<InboxItem>>(tab.req("GET", `/ws/${ws}/inbox?filter=mine&limit=4`));
    expect(first.items.length).toBe(4);
    expect(first.total).toBe(6);
    expect(first.next).toBe("4" as never);
    const second = await json<Page<InboxItem>>(tab.req("GET", `/ws/${ws}/inbox?filter=mine&limit=4&cursor=${first.next}`));
    expect(second.items.length).toBe(2);
    expect(second.next).toBeNull();
    expect([...first.items, ...second.items].map((i) => i.id)).toContain(id);
    const trust = await json<Page<InboxItem>>(tab.req("GET", `/ws/${ws}/inbox?filter=trust`));
    expect(trust.items.map((i) => i.id)).toEqual([id]);
    expect((await tab.req("GET", `/ws/${ws}/inbox?filter=bogus`)).status).toBe(400);
    expect((await tab.req("GET", `/ws/${ws}/inbox?limit=0`)).status).toBe(400);
  });

  test("POST /auth/logout revokes the session; DELETE /workspaces/:ws unloads or forgets", async () => {
    const t = await h.browser();
    expect((await t.req("POST", "/auth/logout")).status).toBe(200);
    expect((await t.req("GET", "/settings")).status).toBe(401);
    const other = await h.openProject("other");
    expect((await h.cli("DELETE", `/workspaces/${other}`)).status).toBe(200);
    expect(h.daemon.services.workspaces.loaded()).not.toContain(other);
    expect((await h.cli("DELETE", `/workspaces/${other}?forget=1`)).status).toBe(200);
    expect(h.daemon.services.workspaces.has(other)).toBe(false);
  });

  test("POST /workspaces: not-a-project ⇒ 422 E_WS_NOT_PROJECT; GitHub URL without gh ⇒ E_GIT_CLONE_FAILED", async () => {
    const res = await h.cli("POST", "/workspaces", { target: "/" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("E_WS_NOT_PROJECT");
    const gh = await h.cli("POST", "/workspaces", { target: "https://github.com/oven-sh/bun" });
    expect(((await gh.json()) as { error: { code: string } }).error.code).toBe("E_GIT_CLONE_FAILED");
    const bad = await h.cli("POST", "/workspaces", { target: "https://github.com/a/b/c" });
    expect(bad.status).toBe(400);
  });
});
