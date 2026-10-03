/**
 * Inbox (contract `InboxStore`). WP-10a holds the list and the header badge (`mineCount`); the Inbox screen and
 * its actions are WP-10b's.
 */
import type { ApiClient } from "@mitori/client";
import type { InboxItem, WorkspaceKey } from "@mitori/core";
import type { InboxStore, InboxView } from "../contract.ts";

export class InboxState implements InboxStore {
  items = $state.raw<readonly InboxItem[]>([]);
  view = $state<InboxView>("mine");
  index = $state(0);
  selected = $state.raw<ReadonlySet<string>>(new Set());
  loaded = $state(false);
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;

  constructor(api: ApiClient, ws: () => WorkspaceKey | null) {
    this.api = api;
    this.ws = ws;
  }

  get mineCount(): number {
    let n = 0;
    for (const it of this.items) if (it.tags.includes("mine")) n++;
    return n;
  }

  async load(): Promise<void> {
    const ws = this.ws();
    if (!ws) return;
    try {
      const page = await this.api.call("GET /ws/:ws/inbox", { params: { ws }, query: { limit: 200 } });
      if (this.ws() === ws) this.items = page.items;
    } catch {
      /* badge stays hidden */
    } finally {
      this.loaded = true;
    }
  }

  reset(): void {
    this.items = [];
    this.loaded = false;
  }
}
