/**
 * Port adapters of the composition root that have no home in the contract yet (each marked CR-PENDING):
 * the daemon lock over `@mitori/platform`'s lock, a SafeWriter that can create the doc root, and the neutral token
 * calibration.
 */
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { type FsReader, type Iso8601, MitoriError, type SafeWriteKind, type SafeWriter } from "@mitori/core";
import type { IndexerCalibration } from "@mitori/indexer";
import { acquireLock, runToExit } from "@mitori/platform";
import { DAEMON, type DaemonLock } from "../contract.ts";
import type { LockFilePort } from "../http/lock.ts";

/** Holder health as the CLI checks it (`GET /health` within `DAEMON.healthTimeoutMs`). */
async function healthy(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(DAEMON.healthTimeoutMs) });
    return res.ok && ((await res.json()) as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

/**
 * Take `~/.mitori/daemon.lock` with the platform's O_EXCL lock (stale holders reclaimed after
 * `DAEMON.lockStaleProbes` probes), then hand `startDaemon` a {@link LockFilePort} that already holds it.
 * CR-PENDING(WP-INT): `ServerDeps` has no lock port (cr-requests/WP-09.md); `startDaemon`'s own primitive needs a
 * synchronous O_EXCL create the platform does not export.
 */
export async function holdDaemonLock(
  path: string,
  pid: number,
  startedAt: Iso8601,
  remove: () => Promise<void>,
): Promise<{ port: LockFilePort; removed: () => Promise<void> } | { holder: DaemonLock | null }> {
  const lock = await acquireLock<DaemonLock>(path, { pid, startedAt, port: 0 }, { probes: DAEMON.lockStaleProbes, verifyHolder: (h) => healthy(h.port) });
  if (!lock.ok) return { holder: lock.holder };
  let removing: Promise<void> = Promise.resolve();
  const port: LockFilePort = {
    tryCreate: () => true,
    read(p) {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    remove() {
      removing = remove().catch(() => undefined);
    },
  };
  return { port, removed: () => removing };
}

/**
 * A SafeWriter whose `doc` / `prep` writes create a missing doc root first (a fresh repo has no `.mitori/`).
 * CR-PENDING(WP-INT): cr-requests/WP-04.md "SafeWriter must be able to create the doc root (WP-01)"; the root is
 * created by writing (then removing) a marker through the nearest existing ancestor (`accept` inside the repo,
 * `home` inside `~/.mitori`), so every byte still goes through the platform SafeWriter.
 */
export function docRootWriter(inner: SafeWriter, fs: FsReader, roots: { home: string; repo: (root: string) => string | null }): SafeWriter {
  const ensuring = new Map<string, Promise<void>>();
  const ensure = async (root: string) => {
    if (fs.stat(root)?.isDir) return;
    let anc = dirname(root);
    while (dirname(anc) !== anc && !fs.stat(anc)?.isDir) anc = dirname(anc);
    const real = fs.realpath(anc) ?? anc;
    const homeRel = relative(roots.home, real);
    const underHome = homeRel === "" || (homeRel !== ".." && !homeRel.startsWith(`..${sep}`) && !isAbsolute(homeRel));
    const kind: SafeWriteKind = underHome ? "home" : "accept";
    if (kind === "accept" && roots.repo(real) === null) throw new MitoriError("E_PATH_OUTSIDE", "doc root outside the workspace", { params: { root } });
    const marker = `${relative(anc, root).split(sep).join("/")}/.mitori-mkdir`;
    await inner.write(real, marker, "", kind);
    await inner.remove(real, marker, kind);
  };
  return {
    async write(root, rel, data, kind) {
      if ((kind === "doc" || kind === "prep") && !fs.stat(root)?.isDir) {
        let p = ensuring.get(root);
        if (!p) {
          p = ensure(root).finally(() => ensuring.delete(root));
          ensuring.set(root, p);
        }
        await p;
      }
      return inner.write(root, rel, data, kind);
    },
    remove: (root, rel, kind) => inner.remove(root, rel, kind),
  };
}

/**
 * `kind:*` token calibration for the indexer. CR-PENDING(WP-INT): the ledger has no `kind:*` surface yet
 * (cr-requests/WP-05.md #9), so the factors stay neutral.
 */
export const NEUTRAL_CALIBRATION: IndexerCalibration = { kindFactor: () => 1, version: 0 };

/**
 * A non-git directory gets a shadow repository on first open (indexer spec §2.1-b): `GIT_DIR` under
 * `~/.mitori/repos/<ws>/shadow.git`, `info/exclude` = the indexer's shadow excludes, untracked cache on. Nothing is
 * written into the user's directory.
 */
export async function ensureShadowRepo(
  o: { home: string; ws: string; root: string; fs: FsReader; safeWrite: SafeWriter; spawner: import("@mitori/agent").Spawner; safePath: string },
  excludes: readonly string[],
): Promise<string> {
  const rel = `repos/${o.ws}/shadow.git`;
  const gitDir = `${o.home}/${rel}`;
  if (o.fs.stat(`${gitDir}/HEAD`)?.isFile) return gitDir;
  await o.safeWrite.write(o.home, `${rel}/info/exclude`, `${excludes.join("\n")}\n`, "home");
  const git = async (...argv: string[]) => {
    const r = await runToExit(o.spawner, {
      command: "git",
      argv,
      env: {
        PATH: o.safePath,
        HOME: o.home,
        GIT_DIR: gitDir,
        GIT_WORK_TREE: o.root,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
      cwd: o.root,
      stdin: "",
      keepStdinOpen: false,
      timeoutMs: 30_000,
      processGroup: true,
    });
    if (r.code !== 0)
      throw new MitoriError("E_GIT_FAILED", `git ${argv[0]} failed for the shadow repository`, {
        params: { exit: r.code },
        hint: r.stderr.slice(-3).join(" | "),
      });
  };
  await git("init", "--quiet", "--object-format=sha1");
  await git("config", "core.untrackedCache", "true");
  await git("config", "core.fsmonitor", "false");
  await git("config", "core.quotepath", "off");
  return gitDir;
}
