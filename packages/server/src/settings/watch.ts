/**
 * Human edits of `~/.mitori/config.json` (server spec §6.7): a cheap `stat` poll of that one file (no recursive
 * watcher over `~/.mitori`, whose SQLite files churn constantly). A changed size / mtime / inode triggers
 * `SettingsService.reload()`, which compares the text, so the daemon's own writes never re-trigger anything.
 */
import type { FsReader, Logger } from "@mitori/core";
import type { TimerHandle, Timers } from "../http/timers.ts";
import type { SettingsService } from "./service.ts";

export const CONFIG_POLL_MS = 2000;

export function watchConfigFile(opts: { settings: SettingsService; fs: FsReader; timers: Timers; log: Logger; pollMs?: number }): () => void {
  const pollMs = opts.pollMs ?? CONFIG_POLL_MS;
  const sig = () => {
    const st = opts.fs.stat(opts.settings.path);
    return st ? `${st.size}:${st.mtimeNs}:${st.ino}` : "-";
  };
  let last = sig();
  let timer: TimerHandle | null = null;
  let stopped = false;
  const tick = async () => {
    timer = null;
    const now = sig();
    if (now !== last) {
      last = now;
      await opts.settings.reload().catch((e) => opts.log.warn("config.json reload failed", { err: String(e) }));
    }
    if (!stopped) timer = opts.timers.setTimeout(() => void tick(), pollMs, { unref: true });
  };
  timer = opts.timers.setTimeout(() => void tick(), pollMs, { unref: true });
  return () => {
    stopped = true;
    opts.timers.clearTimeout(timer);
  };
}
