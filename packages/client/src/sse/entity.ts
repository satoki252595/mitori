/** Entity keys of the upsert-like events (SseClient de-duplication by workspace `rev`). */
import type { SseEvent } from "@mitori/core";
import type { EntityKey } from "../contract.ts";

/** Key of the entity an event replaces, for the events whose payload is a full entity; null otherwise. */
export function entityKeyOf(e: SseEvent): EntityKey | null {
  switch (e.type) {
    case "thread.upsert":
      return `thread:${e.thread.id}`;
    case "job.upsert":
      return `job:${e.job.id}`;
    case "doc.block.upsert":
      return `block:${e.block.id}`;
    case "doc.proposal.upsert":
      return `proposal:${e.proposal.id}`;
    case "checkpoint.upsert":
      return `checkpoint:${e.checkpoint.id}`;
    case "gen.run":
      return `run:${e.run.id}`;
    case "gen.task":
      return `task:${e.task.id}`;
    case "review.round":
      return `round:${e.round.n}`;
    default:
      return null;
  }
}
