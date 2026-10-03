/**
 * The workspace's loop part until `createLoop` (WP-08b) exists (`packages/loop/src/jobs/index.ts` is still the M0
 * stub). CR-PENDING(WP-INT): the reads answer "nothing yet" (no threads, jobs, checkpoints) so the Reader, the
 * inbox and the DOMAIN_WIRING reanchor step work at M1; every mutation reports `E_UNSUPPORTED` naming WP-08b.
 */
import { MitoriError } from "@mitori/core";
import type { GitSafety, JobRunner, ReviewEngine } from "@mitori/loop";
import type { WorkspaceRuntime } from "../contract.ts";

function partial<T extends object>(name: string, impl: Partial<T>): T {
  return new Proxy(impl as T, {
    get(target, prop) {
      const v = (target as Record<string | symbol, unknown>)[prop];
      if (v !== undefined || typeof prop !== "string" || prop === "then") return v;
      return () => {
        throw new MitoriError("E_UNSUPPORTED", `${name}.${prop} arrives with createLoop (WP-08b)`, { params: { what: `${name}.${prop}` } });
      };
    },
  });
}

export function pendingLoop(): WorkspaceRuntime["loop"] {
  const review = partial<ReviewEngine>("loop.review", {
    list: () => ({ items: [], next: null }),
    get: () => null,
    inbox: () => [],
    applyReanchor: () => ({ moved: [], outdated: [], stale: [] }),
    markStale: () => [],
  });
  const jobs = partial<JobRunner>("loop.jobs", {
    get: () => null,
    events: () => [],
    recover: async () => ({ requeued: [], failed: [], kept: [] }),
  });
  const git = partial<GitSafety>("loop.git", {});
  return { review, jobs, git };
}
