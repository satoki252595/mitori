/**
 * Browser sessions (ADR-0009 R1, SEC-06, UXP-07): a 256-bit token per tab login; state.sqlite keeps only
 * `HMAC(session.key, token)` (`srv_sessions`), so sessions survive daemon restarts while a DB leak yields no usable
 * token. 30-day sliding idle expiry; `last_seen_at` is persisted at most once a minute per session.
 */
import {
  type Clock,
  type FsReader,
  type Iso8601,
  type Logger,
  MitoriError,
  newId,
  type Random,
  type SafeWriter,
  type SessionId,
  type SqlDb,
  type WriteQueue,
} from "@mitori/core";
import { DAEMON, type SessionService } from "../contract.ts";
import { hmacHex, newToken, safeEqual } from "./crypto.ts";
import type { NonceStore } from "./nonce.ts";

const DAY_MS = 86_400_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Minimum interval between persisted `last_seen_at` updates of one session. */
const SEEN_PERSIST_MS = 60_000;

/** `~/.mitori/session.key` file name (0600 via SafeWriter kind `home`). */
export const SESSION_KEY_FILE = "session.key";

export interface SessionServiceImpl extends SessionService {
  /** Creation time of a live session (trust decisions need ≥ 60 s) [SEC-19]. */
  createdAt(session: SessionId): Iso8601 | null;
  /** Live sessions (tests, doctor). */
  count(): number;
}

interface Row {
  id: SessionId;
  mac: string;
  created_at: Iso8601;
  last_seen_at: Iso8601;
}

interface Cached {
  id: SessionId;
  mac: string;
  createdAt: Iso8601;
  lastSeen: number;
  persistedSeen: number;
}

/** Read the session key, creating a fresh 256-bit key when missing or malformed. */
export async function loadSessionKey(opts: { home: string; fs: FsReader; safeWrite: SafeWriter; random: Random }): Promise<Uint8Array> {
  const path = `${opts.home}/${SESSION_KEY_FILE}`;
  if (opts.fs.stat(path)?.isFile) {
    const bytes = await opts.fs.read(path);
    if (bytes.byteLength === 32) return bytes;
  }
  return rotateSessionKey(opts);
}

/** Write a new key (`mitori doctor --rotate-session`); callers revoke every session afterwards. */
export async function rotateSessionKey(opts: { home: string; safeWrite: SafeWriter; random: Random }): Promise<Uint8Array> {
  const key = opts.random.bytes(32);
  await opts.safeWrite.write(opts.home, SESSION_KEY_FILE, key, "home");
  return key;
}

export function createSessionService(opts: {
  db: SqlDb;
  stateWrite: WriteQueue;
  key: Uint8Array;
  random: Random;
  clock: Clock;
  nonces: NonceStore;
  log: Logger;
}): SessionServiceImpl {
  const { db, stateWrite, clock } = opts;
  const idleMs = DAEMON.sessionIdleDays * DAY_MS;
  const byMac = new Map<string, Cached>();
  const macOf = (token: string) => hmacHex(opts.key, token);

  const lookup = (mac: string): Cached | null => {
    const hit = byMac.get(mac);
    if (hit) return hit;
    const row = db.get<Row>("SELECT id, mac, created_at, last_seen_at FROM srv_sessions WHERE mac = ?", [mac]);
    if (!row) return null;
    const seen = Date.parse(row.last_seen_at);
    const c: Cached = { id: row.id, mac: row.mac, createdAt: row.created_at, lastSeen: seen, persistedSeen: seen };
    byMac.set(mac, c);
    return c;
  };

  const drop = (c: Cached) => {
    byMac.delete(c.mac);
    stateWrite("session.expire", () => db.run("DELETE FROM srv_sessions WHERE id = ?", [c.id])).catch((e) =>
      opts.log.warn("session expire failed", { err: String(e) }),
    );
  };

  return {
    async exchange(nonce) {
      opts.nonces.consume(nonce);
      const token = newToken(opts.random);
      const session = newId("session", opts.random);
      const mac = macOf(token);
      const now = clock.now();
      const iso = new Date(now).toISOString();
      await stateWrite("session.create", () =>
        db.run("INSERT INTO srv_sessions (id, mac, created_at, last_seen_at, ua_hash) VALUES (?, ?, ?, ?, NULL)", [session, mac, iso, iso]),
      );
      byMac.set(mac, { id: session, mac, createdAt: iso, lastSeen: now, persistedSeen: now });
      return { token, session, expiresAt: new Date(now + idleMs).toISOString() };
    },
    verify(token) {
      if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
      const mac = macOf(token);
      const c = lookup(mac);
      if (!c || !safeEqual(c.mac, mac)) return null;
      const now = clock.now();
      if (now - c.lastSeen > idleMs) {
        drop(c);
        return null;
      }
      c.lastSeen = now;
      if (now - c.persistedSeen >= SEEN_PERSIST_MS) {
        c.persistedSeen = now;
        const iso = new Date(now).toISOString();
        stateWrite("session.seen", () => db.run("UPDATE srv_sessions SET last_seen_at = ? WHERE id = ?", [iso, c.id])).catch((e) =>
          opts.log.warn("session touch failed", { err: String(e) }),
        );
      }
      return { session: c.id, createdAt: c.createdAt };
    },
    async revoke(session) {
      if (session === "all") {
        byMac.clear();
        await stateWrite("session.revoke-all", () => db.run("DELETE FROM srv_sessions"));
        return;
      }
      for (const [mac, c] of byMac) if (c.id === session) byMac.delete(mac);
      await stateWrite("session.revoke", () => db.run("DELETE FROM srv_sessions WHERE id = ?", [session]));
    },
    createdAt(session) {
      for (const c of byMac.values()) if (c.id === session) return c.createdAt;
      return db.get<{ created_at: Iso8601 }>("SELECT created_at FROM srv_sessions WHERE id = ?", [session])?.created_at ?? null;
    },
    count: () => db.get<{ n: number }>("SELECT count(*) AS n FROM srv_sessions")?.n ?? 0,
  };
}

/** `E_AUTH_REQUIRED` with the UI hint (401 ⇒ the tab shows the `mitori open` command) [UXP-07]. */
export function authRequired(message = "authentication required"): MitoriError {
  return new MitoriError("E_AUTH_REQUIRED", message, { hint: "run `mitori open` to sign this tab in again" });
}
