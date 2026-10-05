/**
 * Inbox (contract `InboxStore`). WP-10a holds the list and the header badge (`mineCount`); the Inbox screen and
 * its actions are WP-10b's.
 */
import type { ApiClient } from "@mitori/client";
import type { Cursor, InboxItem, Page, WorkspaceKey } from "@mitori/core";
import type { InboxStore, InboxView } from "../contract.ts";

export class InboxState implements InboxStore {
  items = $state.raw<readonly InboxItem[]>([]);
  view = $state<InboxView>("mine");
  index = $state(0);
  selected = $state.raw<ReadonlySet<string>>(new Set());
  loaded = $state(false);
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;
  #load = 0;

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
    const load = ++this.#load;
    try {
      const items = new Map<string, InboxItem>();
      const seen = new Set<Cursor>();
      let cursor: Cursor | null = null;
      do {
        const page: Page<InboxItem> = await this.api.call("GET /ws/:ws/inbox", { params: { ws }, query: { limit: 200, ...(cursor ? { cursor } : {}) } });
        if (this.ws() !== ws || this.#load !== load) return;
        for (const item of page.items) items.set(`${item.kind}:${item.id}`, item);
        cursor = page.next;
        if (cursor && seen.has(cursor)) throw new Error("repeated inbox cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      this.items = [...items.values()];
    } catch {
      /* badge stays hidden */
    } finally {
      if (this.ws() === ws && this.#load === load) this.loaded = true;
    }
  }

  reset(): void {
    this.#load++;
    this.items = [];
    this.loaded = false;
  }
}
