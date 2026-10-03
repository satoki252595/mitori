/**
 * The server's own tables (`srv_*`). Applied by the migration runner in `MIGRATION_ORDER` (server first);
 * `migrationsFor` (wiring/, WP-INT) concatenates these with the other packages' lists.
 */
import type { Migration } from "@mitori/core";

/** `~/.mitori/state.sqlite`. */
export const SERVER_STATE_MIGRATIONS: readonly Migration[] = [
  {
    pkg: "@mitori/server",
    db: "state",
    version: 1,
    up: `
CREATE TABLE srv_ports (id INTEGER PRIMARY KEY CHECK (id = 1), port INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE srv_sessions (
  id TEXT PRIMARY KEY,
  mac TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ua_hash TEXT
);
CREATE TABLE srv_trust (
  id TEXT PRIMARY KEY,
  ws TEXT NOT NULL,
  item TEXT NOT NULL,
  hash TEXT NOT NULL,
  status TEXT NOT NULL,
  preview TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  UNIQUE (ws, item, hash)
);
CREATE TABLE srv_workspaces (
  key TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  info TEXT NOT NULL,
  summary TEXT,
  registered_at TEXT NOT NULL,
  last_opened_at TEXT
);
CREATE INDEX srv_workspaces_root ON srv_workspaces (root);
CREATE TABLE srv_idempotency_global (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT NOT NULL,
  body BLOB NOT NULL,
  created_ms INTEGER NOT NULL
);
`,
  },
];

/** `<ws>/index.sqlite`. */
export const SERVER_WORKSPACE_MIGRATIONS: readonly Migration[] = [
  {
    pkg: "@mitori/server",
    db: "workspace",
    version: 1,
    up: `
CREATE TABLE srv_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE srv_idempotency (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT NOT NULL,
  body BLOB NOT NULL,
  created_ms INTEGER NOT NULL
);
`,
  },
];
