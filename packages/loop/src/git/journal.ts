// The accept journal (`job_checkpoints`, spec §7.8-7 / §7.11): a row in state `writing` is inserted BEFORE any
// working-tree file is written and turned `done` after the checkpoint refs exist, so a daemon that dies mid-accept
// can tell applied, unapplied and mixed states apart (`recoverAccept`). Every mutation goes through the workspace
// write queue (ADR-0009).
import type { Checkpoint, CheckpointId, Clock, GitOid, Iso8601, JobId, ProposalId, SqlDb, WriteQueue } from "@mitori/core";
import type { CheckpointFile } from "../contract.ts";

/** A journal row. */
export interface JournalRow {
  /** Checkpoint id. */
  id: CheckpointId;
  /** Job. */
  job: JobId;
  /** `refs/mitori/ck/<id>`. */
  ref: string;
  /** Snapshot S (pre-accept working tree). */
  before: GitOid;
  /** Accept commit (`""` while writing). */
  after: GitOid | "";
  /** Files with before / after blobs. */
  files: CheckpointFile[];
  /** Auto-commit / explicit commit in the user's repository. */
  commit: GitOid | null;
  /** Created. */
  createdAt: Iso8601;
  /** Undone. */
  undoneAt: Iso8601 | null;
  /** Journal state. */
  state: "writing" | "done" | "rolled_back";
  /** Extras. */
  extra: JournalExtra;
}

/** Checkpoint extras (v2 `extra` JSON). */
export interface JournalExtra {
  /** Doc proposals accepted with this checkpoint (undone with it, spec §7.9-5). */
  proposals?: ProposalId[];
  /** `refs/mitori/ck/<id>-pre-force` target of a forced undo. */
  preForce?: GitOid;
  /** Working-tree line endings written per path (`crlf` when the file is checked out with CRLF). */
  eol?: Record<string, "crlf">;
}

interface Row {
  id: string;
  job: string;
  ref: string;
  before: string;
  after: string;
  files: string;
  commit_oid: string | null;
  created_at: string;
  undone_at: string | null;
  state: string;
  extra: string | null;
}

const toRow = (r: Row): JournalRow => ({
  id: r.id as CheckpointId,
  job: r.job as JobId,
  ref: r.ref,
  before: r.before,
  after: r.after,
  files: JSON.parse(r.files) as CheckpointFile[],
  commit: r.commit_oid,
  createdAt: r.created_at,
  undoneAt: r.undone_at,
  state: r.state as JournalRow["state"],
  extra: r.extra ? (JSON.parse(r.extra) as JournalExtra) : {},
});

/** Core `Checkpoint` view of a row. */
export function checkpointOf(r: JournalRow): Checkpoint {
  const ck: Checkpoint = { id: r.id, job: r.job, ref: r.ref, before: r.before, after: r.after, files: r.files.map((f) => f.path), createdAt: r.createdAt };
  if (r.commit) ck.commit = r.commit;
  if (r.undoneAt) ck.undoneAt = r.undoneAt;
  return ck;
}

/** SQL of the journal. */
export class Journal {
  constructor(
    private readonly db: SqlDb,
    private readonly write: WriteQueue,
    private readonly clock: Clock,
  ) {}

  get(id: CheckpointId): JournalRow | null {
    const r = this.db.get<Row>("SELECT * FROM job_checkpoints WHERE id = ?", [id]);
    return r ? toRow(r) : null;
  }

  /** Checkpoints of a job, newest first. */
  ofJob(job: JobId): JournalRow[] {
    return this.db.all<Row>("SELECT * FROM job_checkpoints WHERE job = ? ORDER BY created_at DESC, id DESC", [job]).map(toRow);
  }

  /** Rows still `writing` (crash recovery). */
  writing(): JournalRow[] {
    return this.db.all<Row>("SELECT * FROM job_checkpoints WHERE state = 'writing' ORDER BY created_at, id").map(toRow);
  }

  /** All done rows, newest first (ref GC). */
  done(): JournalRow[] {
    return this.db.all<Row>("SELECT * FROM job_checkpoints WHERE state = 'done' ORDER BY created_at DESC, id DESC").map(toRow);
  }

  begin(row: Pick<JournalRow, "id" | "job" | "ref" | "before" | "files" | "extra">): Promise<void> {
    return this.write("git.journal.begin", () => {
      this.db.run(
        "INSERT INTO job_checkpoints (id, job, ref, before, after, files, commit_oid, created_at, undone_at, state, extra) VALUES (?, ?, ?, ?, '', ?, NULL, ?, NULL, 'writing', ?)",
        [row.id, row.job, row.ref, row.before, JSON.stringify(row.files), this.clock.iso(), JSON.stringify(row.extra)],
      );
    });
  }

  finish(id: CheckpointId, after: GitOid): Promise<void> {
    return this.write("git.journal.done", () => {
      this.db.run("UPDATE job_checkpoints SET after = ?, state = 'done' WHERE id = ?", [after, id]);
    });
  }

  rolledBack(id: CheckpointId): Promise<void> {
    return this.write("git.journal.rollback", () => {
      this.db.run("UPDATE job_checkpoints SET state = 'rolled_back' WHERE id = ?", [id]);
    });
  }

  drop(id: CheckpointId): Promise<void> {
    return this.write("git.journal.drop", () => {
      this.db.run("DELETE FROM job_checkpoints WHERE id = ?", [id]);
    });
  }

  setCommit(id: CheckpointId, commit: GitOid): Promise<void> {
    return this.write("git.journal.commit", () => {
      this.db.run("UPDATE job_checkpoints SET commit_oid = ? WHERE id = ?", [commit, id]);
    });
  }

  undone(id: CheckpointId): Promise<Iso8601> {
    const at = this.clock.iso();
    return this.write("git.journal.undone", () => {
      this.db.run("UPDATE job_checkpoints SET undone_at = ? WHERE id = ?", [at, id]);
      return at;
    });
  }

  /** Merge extras (inside the caller's write slot when `inSlot`). */
  patchExtra(id: CheckpointId, patch: JournalExtra, inSlot = false): Promise<void> | void {
    const apply = () => {
      const cur = this.get(id);
      if (!cur) return;
      this.db.run("UPDATE job_checkpoints SET extra = ? WHERE id = ?", [JSON.stringify({ ...cur.extra, ...patch }), id]);
    };
    if (inSlot) {
      apply();
      return;
    }
    return this.write("git.journal.extra", apply);
  }
}
