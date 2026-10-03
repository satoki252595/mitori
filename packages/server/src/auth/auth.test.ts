import { describe, expect, test } from "bun:test";
import { isId, MitoriError } from "@mitori/core";
import { SERVER_STATE_MIGRATIONS } from "../http/schema.ts";
import { fakeClock, fsReader, fsSafeWriter, migrate, removeDir, seededRandom, silentLogger, sqliteDb, tempDir } from "../http/test/fakes.ts";
import { createStateQueue } from "../ws/queue.ts";
import { CHALLENGE_RE, createBearer, healthProof } from "./bearer.ts";
import { hmacHex } from "./crypto.ts";
import { createNonceStore, validateRedirect } from "./nonce.ts";
import { createSessionService, loadSessionKey } from "./session.ts";

const metrics = { inc() {}, observe() {} };

function sessions(opts: { path?: string; key?: Uint8Array; seed?: number } = {}) {
  const clock = fakeClock();
  const random = seededRandom(opts.seed ?? 11);
  const db = migrate(sqliteDb(opts.path), opts.path ? [] : SERVER_STATE_MIGRATIONS);
  const stateWrite = createStateQueue({ db, metrics, dev: true });
  const nonces = createNonceStore({ random, clock });
  const key = opts.key ?? new Uint8Array(32).fill(7);
  const svc = createSessionService({ db, stateWrite, key, random, clock, nonces, log: silentLogger });
  return { clock, db, nonces, svc, key };
}

const code = (e: unknown) => (e instanceof MitoriError ? e.code : String(e));

describe("SRV-I-009 nonce", () => {
  test("single use; expired after 60 s; URL carries the nonce in the fragment", async () => {
    const { nonces, svc, clock } = sessions();
    const { url, expiresAt } = nonces.issue("/w/ws_x/doc", 4123);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4123\/auth#n=[A-Za-z0-9_-]{43}&to=%2Fw%2Fws_x%2Fdoc$/);
    expect(Date.parse(expiresAt) - clock.now()).toBe(60_000);
    const nonce = new URL(url).hash.slice(3).split("&")[0] as string;
    await svc.exchange(nonce);
    expect(await svc.exchange(nonce).then(() => "ok", code)).toBe("E_AUTH_REQUIRED");
    const late = new URL(nonces.issue(undefined, 1).url).hash.slice(3).split("&")[0] as string;
    clock.advance(61_000);
    expect(await svc.exchange(late).then(() => "ok", code)).toBe("E_AUTH_REQUIRED");
    expect(await svc.exchange("garbage").then(() => "ok", code)).toBe("E_AUTH_REQUIRED");
  });

  test("`to` must be an in-app path", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "evil", "/a\u0000b", "/ok\nx", "\\\\server\\share"]) {
      expect(() => validateRedirect(bad)).toThrow();
      try {
        validateRedirect(bad);
      } catch (e) {
        expect((e as MitoriError).http).toBe(400);
      }
    }
    expect(validateRedirect(undefined)).toBe("/");
    expect(validateRedirect("/w/ws_1/doc/s3?ctx=code#b_12345678")).toBe("/w/ws_1/doc/s3?ctx=code#b_12345678");
  });
});

describe("SRV-I-010 sessions", () => {
  test("token is 256-bit base64url; srv_sessions stores only the HMAC; verify slides; revoke works", async () => {
    const { nonces, svc, db, key, clock } = sessions();
    const nonce = new URL(nonces.issue("/", 1).url).hash.slice(3).split("&")[0] as string;
    const res = await svc.exchange(nonce);
    expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(res.token, "base64url").byteLength).toBe(32);
    expect(isId("session", res.session)).toBe(true);
    expect(Date.parse(res.expiresAt) - clock.now()).toBe(30 * 86_400_000);
    const rows = db.all<Record<string, string>>("SELECT * FROM srv_sessions");
    expect(rows.length).toBe(1);
    expect(rows[0]?.mac).toBe(hmacHex(key, res.token));
    expect(JSON.stringify(rows)).not.toContain(res.token);
    expect(svc.verify(res.token)?.session).toBe(res.session);
    expect(svc.verify(`${res.token.slice(0, -1)}A`)).toBeNull();
    expect(svc.verify("short")).toBeNull();
    clock.advance(29 * 86_400_000);
    expect(svc.verify(res.token)).not.toBeNull(); // slides
    clock.advance(29 * 86_400_000);
    expect(svc.verify(res.token)).not.toBeNull();
    clock.advance(31 * 86_400_000);
    expect(svc.verify(res.token)).toBeNull(); // idle > 30 days
    const again = await svc.exchange(new URL(nonces.issue("/", 1).url).hash.slice(3).split("&")[0] as string);
    await svc.revoke(again.session);
    expect(svc.verify(again.token)).toBeNull();
  });

  test("UXP-07: a session survives a daemon restart (same session.key + state.sqlite)", async () => {
    const dir = tempDir();
    try {
      const safeWrite = fsSafeWriter();
      const random = seededRandom(5);
      const key = await loadSessionKey({ home: dir, fs: fsReader, safeWrite, random });
      expect(key.byteLength).toBe(32);
      expect(await loadSessionKey({ home: dir, fs: fsReader, safeWrite, random })).toEqual(key);
      const path = `${dir}/state.sqlite`;
      migrate(sqliteDb(path), SERVER_STATE_MIGRATIONS).close();
      const a = sessions({ path, key });
      const res = await a.svc.exchange(new URL(a.nonces.issue("/", 1).url).hash.slice(3).split("&")[0] as string);
      a.db.close();
      const b = sessions({ path, key, seed: 99 });
      expect(b.svc.verify(res.token)?.session).toBe(res.session);
      expect(b.svc.createdAt(res.session)).toBe(a.clock.iso());
      const rotated = sessions({ path, key: new Uint8Array(32).fill(1), seed: 98 });
      expect(rotated.svc.verify(res.token)).toBeNull();
      b.db.close();
      rotated.db.close();
    } finally {
      removeDir(dir);
    }
  });
});

describe("SRV-I-011 bearer", () => {
  test("256-bit, rotated per start, constant-time check, health proof = HMAC(token, challenge)", () => {
    const a = createBearer(seededRandom(1));
    const b = createBearer(seededRandom(2));
    expect(Buffer.from(a.token, "base64url").byteLength).toBe(32);
    expect(a.token).not.toBe(b.token);
    expect(a.check(a.token)).toBe(true);
    expect(a.check(b.token)).toBe(false);
    expect(a.check("")).toBe(false);
    const challenge = "0123456789abcdef0123456789abcdef";
    expect(CHALLENGE_RE.test(challenge)).toBe(true);
    expect(a.proof(challenge)).toBe(healthProof(a.token, challenge));
    expect(a.proof(challenge)).not.toBe(b.proof(challenge));
  });
});
