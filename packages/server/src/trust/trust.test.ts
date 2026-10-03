import { describe, expect, test } from "bun:test";
import { type Iso8601, MitoriError, type SessionId, type SseEventPayload, type TrustRecord, type WorkspaceKey } from "@mitori/core";
import { SERVER_STATE_MIGRATIONS } from "../http/schema.ts";
import { fakeClock, migrate, noopMetrics, removeDir, seededRandom, silentLogger, sqliteDb, tempDir } from "../http/test/fakes.ts";
import { createStateQueue } from "../ws/queue.ts";
import { createTrustService } from "./service.ts";

const WS = "ws_tttttttttttt" as WorkspaceKey;
const REMOTE = "ws_rrrrrrrrrrrr" as WorkspaceKey;
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const SESSION = "se_000000000001" as SessionId;

function setup(path?: string) {
  const clock = fakeClock();
  const db = migrate(sqliteDb(path), path ? [] : SERVER_STATE_MIGRATIONS);
  const stateWrite = createStateQueue({ db, metrics: noopMetrics, dev: true });
  const published: { payload: SseEventPayload; ws: WorkspaceKey }[] = [];
  const decided: TrustRecord[] = [];
  const sessions = new Map<SessionId, Iso8601>([[SESSION, clock.iso()]]);
  const svc = createTrustService({
    db,
    stateWrite,
    clock,
    random: seededRandom(3),
    sessionCreatedAt: (s) => sessions.get(s) ?? null,
    kindOf: (ws) => (ws === REMOTE ? "remote-readonly" : "git"),
    publish: (payload, ws) => void published.push({ payload, ws }),
    onDecided: (r) => void decided.push(r),
    log: silentLogger,
  });
  return { clock, db, stateWrite, svc, published, decided };
}

const code = (e: unknown) => (e instanceof MitoriError ? e.code : String(e));

describe("trust (server spec §7.1)", () => {
  test("unknown → pending (one trust.request per hash) → trusted; a new hash starts over", async () => {
    const { svc, published, clock, decided } = setup();
    expect(svc.state(WS, "gates", H1)).toBe("unknown");
    const id = svc.request(WS, "gates", H1, "prettier --write {files}");
    expect(svc.request(WS, "gates", H1, "again")).toBe(id);
    expect(svc.state(WS, "gates", H1)).toBe("pending");
    expect(published.map((p) => p.payload.type)).toEqual(["trust.request"]);
    expect(svc.pending(WS)).toBe(1);
    expect(svc.inboxItems(WS)).toMatchObject([{ kind: "trust", id, state: "pending", tags: ["trust", "mine"], href: `/w/${WS}/settings?tab=trust` }]);
    clock.advance(60_000);
    const rec = await svc.decide(id, "trusted", SESSION);
    expect(rec).toMatchObject({ id, ws: WS, item: "gates", hash: H1, decision: "trusted" });
    expect(decided).toEqual([rec]);
    expect(svc.state(WS, "gates", H1)).toBe("trusted");
    expect(svc.state(WS, "gates", H2)).toBe("unknown");
    svc.request(WS, "gates", H2, "changed");
    expect(svc.state(WS, "gates", H2)).toBe("pending");
    expect(
      svc
        .list(WS)
        .map((r) => r.status)
        .sort(),
    ).toEqual(["pending", "trusted"]);
  });

  test("SEC-19: decisions from a session younger than 60 s are rejected", async () => {
    const { svc, clock } = setup();
    const id = svc.request(WS, "rules", H1, "AGENTS.md");
    clock.advance(59_999);
    expect(await svc.decide(id, "trusted", SESSION).then(() => "ok", code)).toBe("E_FORBIDDEN");
    expect(await svc.decide(id, "trusted", "se_unknown00000" as SessionId).then(() => "ok", code)).toBe("E_AUTH_REQUIRED");
    expect(await svc.decide("tr_nope0000" as never, "trusted", SESSION).then(() => "ok", code)).toBe("E_NOT_FOUND");
    clock.advance(1);
    expect((await svc.decide(id, "denied", SESSION)).decision).toBe("denied");
  });

  test("SEC-14: remote-readonly gates start denied and emit no request", () => {
    const { svc, published } = setup();
    svc.request(REMOTE, "gates", H1, "make test");
    expect(svc.state(REMOTE, "gates", H1)).toBe("denied");
    expect(published).toEqual([]);
    svc.request(REMOTE, "rules", H1, "AGENTS.md");
    expect(svc.state(REMOTE, "rules", H1)).toBe("pending");
  });

  test("decisions persist across a restart", async () => {
    const dir = tempDir();
    try {
      const path = `${dir}/state.sqlite`;
      migrate(sqliteDb(path), SERVER_STATE_MIGRATIONS).close();
      const a = setup(path);
      const id = a.svc.request(WS, "git_config", H1, "core.sshCommand");
      a.clock.advance(61_000);
      await a.svc.decide(id, "trusted", SESSION);
      await a.stateWrite("flush", () => null);
      a.db.close();
      const b = setup(path);
      expect(b.svc.state(WS, "git_config", H1)).toBe("trusted");
      b.db.close();
    } finally {
      removeDir(dir);
    }
  });
});
