CREATE TABLE installs (key TEXT PRIMARY KEY, created INTEGER NOT NULL);
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES installs(key),
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 28 AND 5000000),
  expires INTEGER NOT NULL, digest TEXT NOT NULL, comments_auth TEXT NOT NULL, viewer_hash TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX snapshots_owner ON snapshots(owner);
CREATE INDEX snapshots_expiry ON snapshots(expires);
CREATE TABLE comments (
  id TEXT PRIMARY KEY, snapshot TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 28 AND 16384), created INTEGER NOT NULL
);
CREATE INDEX comments_snapshot ON comments(snapshot,created);
CREATE TABLE usage (
  id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL, comment_bytes INTEGER NOT NULL,
  write_month TEXT NOT NULL, writes INTEGER NOT NULL, read_month TEXT NOT NULL, reads INTEGER NOT NULL
);
INSERT INTO usage VALUES(1,0,0,'',0,'',0);
CREATE TRIGGER snapshot_quota BEFORE INSERT ON snapshots BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM snapshots WHERE owner=NEW.owner)>=20
    OR (SELECT count(*) FROM snapshots)>=100000
    OR (SELECT coalesce(sum(bytes),0) FROM snapshots WHERE owner=NEW.owner)
      +(SELECT coalesce(sum(c.bytes),0) FROM comments c JOIN snapshots s ON s.id=c.snapshot WHERE s.owner=NEW.owner)+NEW.bytes>50000000
    OR (SELECT bytes FROM usage WHERE id=1)+NEW.bytes>8000000000
    OR (SELECT CASE WHEN write_month=strftime('%Y-%m','now') THEN writes ELSE 0 END FROM usage WHERE id=1)>=10000
    THEN RAISE(ABORT,'snapshot quota') END;
END;
CREATE TRIGGER snapshot_reserve AFTER INSERT ON snapshots BEGIN
  UPDATE usage SET bytes=bytes+NEW.bytes,
    writes=CASE WHEN write_month=strftime('%Y-%m','now') THEN writes+1 ELSE 1 END,
    write_month=strftime('%Y-%m','now') WHERE id=1;
END;
CREATE TRIGGER snapshot_release AFTER DELETE ON snapshots BEGIN
  UPDATE usage SET bytes=bytes-OLD.bytes WHERE id=1;
  DELETE FROM comments WHERE snapshot=OLD.id;
END;
CREATE TRIGGER comment_quota BEFORE INSERT ON comments BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM comments WHERE snapshot=NEW.snapshot)>=100
    OR (SELECT count(*) FROM comments)>=100000
    OR (SELECT coalesce(sum(bytes),0) FROM snapshots WHERE owner=(SELECT owner FROM snapshots WHERE id=NEW.snapshot))
      +(SELECT coalesce(sum(c.bytes),0) FROM comments c JOIN snapshots s ON s.id=c.snapshot WHERE s.owner=(SELECT owner FROM snapshots WHERE id=NEW.snapshot))+NEW.bytes>50000000
    OR (SELECT bytes FROM usage WHERE id=1)+NEW.bytes>8000000000
    OR (SELECT comment_bytes FROM usage WHERE id=1)+NEW.bytes>200000000
    THEN RAISE(ABORT,'comment quota') END;
END;
CREATE TRIGGER comment_reserve AFTER INSERT ON comments BEGIN
  UPDATE usage SET bytes=bytes+NEW.bytes, comment_bytes=comment_bytes+NEW.bytes WHERE id=1;
END;
CREATE TRIGGER comment_release AFTER DELETE ON comments BEGIN
  UPDATE usage SET bytes=bytes-OLD.bytes, comment_bytes=comment_bytes-OLD.bytes WHERE id=1;
END;
