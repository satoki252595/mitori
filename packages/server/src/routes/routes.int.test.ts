import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import type { DaemonStatus, InboxItem, Page, SettingsView, TrustRecord, TrustRequest, WorkspaceKey, WorkspaceStatus, WorkspaceSummary } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { removeDir, tempDir } from "../http/test/fakes.ts";
import { fakeAssemble, type Harness, startHarness } from "../http/test/harness.ts";
import { openSse } from "../http/test/sse-reader.ts";

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

  test("POST /auth/logout revokes the session and ends its SSE streams; DELETE /workspaces/:ws unloads or forgets", async () => {
    const t = await h.browser();
    const keep = await h.browser();
    const mine = await openSse(h.origin, `Mitori-Session ${t.token}`);
    const theirs = await openSse(h.origin, `Mitori-Session ${keep.token}`);
    await mine.until((es) => es.some((e) => e.type === "hello"));
    await theirs.until((es) => es.some((e) => e.type === "hello"));
    expect((await t.req("POST", "/auth/logout")).status).toBe(200);
    await mine.closed; // the revoked session's stream ends; the other session's stream stays
    expect(h.daemon.services.hub.connections({ client: "web" })).toBe(1);
    expect((await t.req("GET", "/settings")).status).toBe(401);
    theirs.close();
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

describe("SRV-I-022 load failure", () => {
  test("GET /ws/:ws after a failed load ⇒ 200 with state error + lastError; the next load recovers", async () => {
    let fail = true;
    const dom = { scans: 0, loads: 0, closes: 0, busy: false, scanGate: null };
    const ok = fakeAssemble(dom);
    const h2 = await startHarness({
      workspace: {
        assemble: async (base) => {
          if (fail) throw new MitoriError("E_INTERNAL", "migration exploded");
          return ok(base);
        },
      },
    });
    const dir = tempDir("mitori-proj-");
    try {
      mkdirSync(`${dir}/src`);
      writeFileSync(`${dir}/package.json`, "{}");
      expect((await h2.cli("POST", "/workspaces", { target: dir })).status).toBe(500);
      const [w] = await json<WorkspaceSummary[]>(h2.cli("GET", "/workspaces"));
      const key = (w as WorkspaceSummary).info.key;
      const st = await h2.cli("GET", `/ws/${key}`);
      expect(st.status).toBe(200);
      const body = (await st.json()) as WorkspaceStatus;
      expect(body.state).toBe("error");
      expect(body.scan.state).toBe("failed");
      expect(body.lastError?.code).toBe("E_INTERNAL");
      fail = false;
      const again = await json<WorkspaceStatus>(h2.cli("GET", `/ws/${key}`));
      expect(["scanning", "ready"]).toContain(again.state);
    } finally {
      removeDir(dir);
      await h2.close();
    }
  });
});
