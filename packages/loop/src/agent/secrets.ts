// F1 (nonfunc audit): agent mode reads the job worktree with Read / Grep — patch and answer bundles go through the
// secret redaction, the worktree did not. A tracked `config/settings.js` holding `sk_live_…` reached the model in clear
// right after the Composer said 「秘密情報は伏せ字」. Before every agent turn the tracked text files of the worktree
// that hold a scanner hit get the hit replaced by a numbered token; after the turn the original bytes come back
// (files outside the write scope) or the tokens the edit kept are put back (files the agent was asked to change: a
// token it deleted is a secret it removed — e.g. "move the key to an env var"). Gates and the head commit see the
// real files; the model never does.
import { type GitOid, MitoriError, type RepoPath, type SecretScanner } from "@mitori/core";

/** Text files above this size are not scanned (the indexer excludes them as oversize anyway). */
const SCAN_MAX_BYTES = 1 << 20;
const NUL_PROBE = 8000;
const dec = new TextDecoder("utf-8", { fatal: false });

/** The token of the k-th secret of a hidden file (1-based). Never a valid identifier or literal in any language. */
export const hiddenToken = (k: number): string => `«redacted:secret#${k}»`;
const TOKEN_RE = /«redacted:secret#(\d+)»/g;

export interface HiddenFile {
  path: RepoPath;
  original: string;
  hidden: string;
  secrets: string[];
  writable: boolean;
}

/** Replace every scanner hit of `text` by its numbered token (line count preserved: the rules match inside lines). */
export function hideText(text: string, secrets: SecretScanner): { hidden: string; secrets: string[] } | null {
  const hits = secrets
    .scan(text)
    .filter((h) => h.end > h.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  if (hits.length === 0) return null;
  const parts: string[] = [];
  const found: string[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue; // overlapping rules: the first (longest) hit wins
    parts.push(text.slice(at, h.start));
    found.push(text.slice(h.start, h.end));
    parts.push(hiddenToken(found.length));
    at = h.end;
  }
  parts.push(text.slice(at));
  return { hidden: parts.join(""), secrets: found };
}

/** Put the secrets back where the edit kept their tokens. Unknown token numbers are an edit the job must not take. */
export function revealText(edited: string, secrets: readonly string[]): string {
  return edited.replace(TOKEN_RE, (m, n: string) => {
    const s = secrets[Number(n) - 1];
    if (s === undefined) throw new MitoriError("E_SCOPE_VIOLATION", `the edit invented a redaction token ${m}`, { params: { reason: "secret_token" } });
    return s;
  });
}

export interface SecretHider {
  /** Files hidden in the worktree now (paths only: for the job card / logs). */
  readonly files: readonly RepoPath[];
  /** Restore the real files (after a turn, before the head commit and the gates). */
  reveal(): Promise<void>;
}

export interface HideDeps {
  secrets: SecretScanner;
  /** Tracked files of the worktree's base commit (blob ids). */
  tree(): Promise<{ path: RepoPath; oid: GitOid; mode: string }[]>;
  blob(oid: GitOid): Promise<Uint8Array>;
  /** Current text of a worktree file (null when the agent deleted it). */
  read(path: RepoPath): Promise<string | null>;
  /** All-or-nothing write of worktree files. */
  write(files: Record<RepoPath, string>): Promise<void>;
  /** Per-blob scan cache shared across jobs (`oid` → hidden form or null). */
  cache: Map<GitOid, { hidden: string; secrets: string[] } | null>;
}

const CACHE_MAX = 20_000;

/** Hide the secrets of the worktree for one agent turn. */
export async function hideSecrets(d: HideDeps, writeScope: readonly RepoPath[]): Promise<SecretHider> {
  const scope = new Set(writeScope);
  const hidden: HiddenFile[] = [];
  for (const e of await d.tree()) {
    if (e.mode !== "100644" && e.mode !== "100755") continue;
    let r = d.cache.get(e.oid);
    if (r === undefined) {
      const bytes = await d.blob(e.oid);
      r = bytes.length > SCAN_MAX_BYTES || bytes.subarray(0, NUL_PROBE).includes(0) ? null : hideText(dec.decode(bytes), d.secrets);
      if (d.cache.size >= CACHE_MAX) d.cache.clear();
      d.cache.set(e.oid, r);
    }
    if (r === null) continue;
    const current = await d.read(e.path);
    if (current === null) continue;
    // a repair turn's worktree holds the agent's edits: hide what is there now, keep the base's secrets list for reveal
    const now = current === dec.decode(await d.blob(e.oid)) ? r : hideText(current, d.secrets);
    if (now === null) continue;
    hidden.push({ path: e.path, original: current, hidden: now.hidden, secrets: now.secrets, writable: scope.has(e.path) });
  }
  if (hidden.length > 0) await d.write(Object.fromEntries(hidden.map((h) => [h.path, h.hidden])));
  let revealed = false;
  return {
    files: hidden.map((h) => h.path),
    async reveal() {
      if (revealed || hidden.length === 0) return;
      revealed = true;
      const out: Record<RepoPath, string> = {};
      for (const h of hidden) {
        const now = await d.read(h.path);
        if (!h.writable || now === null || now === h.hidden) {
          // outside the write scope (any change there fails the post-check anyway), or untouched: the real bytes
          if (now !== null || !h.writable) out[h.path] = h.original;
          continue;
        }
        out[h.path] = revealText(now, h.secrets);
      }
      await d.write(out);
    },
  };
}
