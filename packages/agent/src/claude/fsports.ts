import { type FsReader, type Hasher, MitoriError, type SafeWriter } from "@mitori/core";

/**
 * Filesystem ports the claude-cli engine needs: the content-addressed system prompt files (I3) and the empty sandbox
 * cwd (I9). CR-PENDING(WP-05): `createAgentBridge` deps have no SafeWriter/FsReader yet (cr-requests/WP-05.md #2); the
 * bridge reads them as optional extra deps and the engine reports a problem when they are missing.
 */
export interface BridgeFs {
  safeWrite: SafeWriter;
  fs: FsReader;
}

const enc = new TextEncoder();

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** `run/sp/<sha256[:32]>.txt` relative to the mitori home (SEC-20). */
export const systemPromptRel = (hasher: Hasher, text: string): string => `run/sp/${hasher.sha256(text).slice(0, 32)}.txt`;

/** `~/.mitori/run/empty`. */
export const EMPTY_REL = "run/empty";

/** System prompt files and the empty sandbox (one per bridge). */
export interface SandboxStore {
  /** Write (or reuse after a byte comparison) the system prompt file; returns its absolute path. */
  systemPromptFile(text: string): Promise<string>;
  /** Make sure `~/.mitori/run/empty` exists and is empty (entries are removed). */
  ensureEmptyCwd(): Promise<string>;
}

export function createSandboxStore(home: string, hasher: Hasher, ports: BridgeFs | null): SandboxStore {
  const root = home.replace(/\/+$/, "");
  const need = (): BridgeFs => {
    if (!ports) throw new MitoriError("E_PRECONDITION", "agent bridge filesystem ports are not wired (CR-PENDING WP-05)");
    return ports;
  };
  return {
    async systemPromptFile(text: string): Promise<string> {
      const p = need();
      const rel = systemPromptRel(hasher, text);
      const abs = `${root}/${rel}`;
      const st = p.fs.stat(abs);
      if (st?.isSymlink) throw new MitoriError("E_PATH_SYMLINK", "system prompt file is a symlink");
      const bytes = enc.encode(text);
      // content-addressed, but never trust the name alone: byte-compare before reuse (SEC-20)
      if (!st?.isFile || !sameBytes(await p.fs.read(abs), bytes)) await p.safeWrite.write(root, rel, bytes, "home");
      return abs;
    },
    async ensureEmptyCwd(): Promise<string> {
      const p = need();
      const abs = `${root}/${EMPTY_REL}`;
      const entries = p.fs.readdir(abs);
      if (entries === null) {
        // SafeWriter creates directories component by component; a placeholder materializes the directory
        await p.safeWrite.write(root, `${EMPTY_REL}/.mitori-keep`, "", "home");
        await p.safeWrite.remove(root, `${EMPTY_REL}/.mitori-keep`, "home");
      } else {
        for (const name of entries) await p.safeWrite.remove(root, `${EMPTY_REL}/${name}`, "home");
      }
      return abs;
    },
  };
}
