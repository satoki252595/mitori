/**
 * Trust (server spec §7.1, ADR-0009 R1 §5): `unknown → pending` the first time a content hash is seen (one
 * `trust.request` per hash) → `trusted | denied` by a human in the web UI, from a session at least
 * `DAEMON.trustMinSessionAgeMs` old [SEC-19]; a new hash starts over. `remote-readonly` gates start `denied`
 * (opt-in only) [SEC-14]. Rows live in state.sqlite (`srv_trust`) and are written through `stateWrite`; reads are
 * served from memory so `state()` stays synchronous for the settings resolver.
 */
import {
  type Clock,
  HREFS,
  type InboxItem,
  type Iso8601,
  type Logger,
  MitoriError,
  newId,
  type Random,
  type SessionId,
  type Sha256,
  type SqlDb,
  type SseEventPayload,
  type TrustItemId,
  type TrustRecord,
  type TrustRequest,
  type TrustState,
  type WorkspaceKey,
  type WorkspaceKind,
  type WriteQueue,
} from "@mitori/core";
import { DAEMON, type TrustService } from "../contract.ts";

export interface TrustServiceImpl extends TrustService {
  /** Every request of a workspace (`GET /ws/:ws/trust`), newest first. */
  list(ws: WorkspaceKey): TrustRequest[];
  /** Pending requests (WorkspaceStatus.trustPending). */
  pending(ws: WorkspaceKey): number;
  /** Pending requests as inbox rows (InboxSources.trust). */
  inboxItems(ws: WorkspaceKey): InboxItem[];
}

interface Row {
  id: TrustItemId;
  ws: WorkspaceKey;
  item: TrustRecord["item"];
  hash: Sha256;
  status: "pending" | "trusted" | "denied";
  preview: string;
  created_at: Iso8601;
  decided_at: Iso8601 | null;
}

const keyOf = (ws: string, item: string, hash: string) => `${ws}\u0000${item}\u0000${hash}`;

export function createTrustService(opts: {
  db: SqlDb;
  stateWrite: WriteQueue;
  clock: Clock;
  random: Random;
  /** Creation time of a browser session (null when unknown/revoked). */
  sessionCreatedAt: (session: SessionId) => Iso8601 | null;
  /** Kind of a registered workspace. */
  kindOf: (ws: WorkspaceKey) => WorkspaceKind | null;
  publish: (payload: SseEventPayload, ws: WorkspaceKey) => void;
  /** `trust.decided` wiring (gates waiting for trust are re-evaluated) [server spec §4.2]. */
  onDecided?: (record: TrustRecord) => void;
  log: Logger;
}): TrustServiceImpl {
  const { db, stateWrite, clock } = opts;
  const byKey = new Map<string, Row>();
  const byId = new Map<TrustItemId, Row>();
  for (const r of db.all<Row>("SELECT id, ws, item, hash, status, preview, created_at, decided_at FROM srv_trust")) {
    byKey.set(keyOf(r.ws, r.item, r.hash), r);
    byId.set(r.id, r);
  }
  const view = (r: Row): TrustRequest => ({ id: r.id, item: r.item, hash: r.hash, preview: r.preview, status: r.status });
  const rowsOf = (ws: WorkspaceKey) => [...byId.values()].filter((r) => r.ws === ws);

  return {
    state(ws, item, hash) {
      return byKey.get(keyOf(ws, item, hash))?.status ?? ("unknown" satisfies TrustState);
    },
    request(ws, item, hash, preview) {
      const existing = byKey.get(keyOf(ws, item, hash));
      if (existing) return existing.id;
      const row: Row = {
        id: newId("trust", opts.random),
        ws,
        item,
        hash,
        status: item === "gates" && opts.kindOf(ws) === "remote-readonly" ? "denied" : "pending",
        preview: preview.slice(0, 8000),
        created_at: clock.iso(),
        decided_at: null,
      };
      byKey.set(keyOf(ws, item, hash), row);
      byId.set(row.id, row);
      stateWrite("trust.request", () =>
        db.run("INSERT OR IGNORE INTO srv_trust (id, ws, item, hash, status, preview, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          row.id,
          ws,
          item,
          hash,
          row.status,
          row.preview,
          row.created_at,
        ]),
      ).catch((e) => opts.log.error("trust request not persisted", { err: String(e) }));
      if (row.status === "pending") opts.publish({ type: "trust.request", request: view(row) }, ws);
      return row.id;
    },
    async decide(id, decision, session) {
      const row = byId.get(id);
      if (!row) throw new MitoriError("E_NOT_FOUND", "unknown trust request", { params: { id } });
      const created = opts.sessionCreatedAt(session);
      if (created === null) throw new MitoriError("E_AUTH_REQUIRED", "session not found");
      if (clock.now() - Date.parse(created) < DAEMON.trustMinSessionAgeMs)
        throw new MitoriError("E_FORBIDDEN", "trust decisions need a browser session that is at least 60 s old", {
          hint: "read the request, then decide again in a moment",
        });
      const at = clock.iso();
      await stateWrite("trust.decide", () =>
        db.run("UPDATE srv_trust SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?", [decision, at, session, id]),
      );
      row.status = decision;
      row.decided_at = at;
      const record: TrustRecord = { id, ws: row.ws, item: row.item, hash: row.hash, decision, at };
      opts.publish({ type: "trust.request", request: view(row) }, row.ws);
      opts.onDecided?.(record);
      return record;
    },
    list: (ws) =>
      rowsOf(ws)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1))
        .map(view),
    pending: (ws) => rowsOf(ws).filter((r) => r.status === "pending").length,
    inboxItems: (ws) =>
      rowsOf(ws)
        .filter((r) => r.status === "pending")
        .map((r) => ({
          kind: "trust",
          id: r.id,
          title: r.preview.split("\n", 1)[0] ?? r.item,
          state: "pending",
          tags: ["trust", "mine"],
          updatedAt: r.created_at,
          href: `${HREFS.map(ws)}/settings?tab=trust`,
        })),
  };
}
