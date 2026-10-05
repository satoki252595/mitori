import { expect, test } from "bun:test";
import type { ApiClient } from "@mitori/client";
import type { InboxItem, WorkspaceKey } from "@mitori/core";
import { installRunes } from "./__tests__/runes.ts";

installRunes();
const { InboxState } = await import("./inbox.svelte.ts");

test("Inbox follows 200-item cursors to all 500 items and discards a late workspace page", async () => {
  const all = Array.from({ length: 500 }, (_, i) => ({ kind: "thread", id: String(i), tags: ["mine"] })) as InboxItem[];
  const calls: (string | undefined)[] = [];
  let ws = "ws_000000000000" as WorkspaceKey;
  const api = {
    call: async (_: string, { query }: { query: { cursor?: string } }) => {
      calls.push(query.cursor);
      const from = Number(query.cursor ?? 0);
      return { items: all.slice(from, from + 200), next: from + 200 < all.length ? String(from + 200) : null };
    },
  } as unknown as ApiClient;
  const inbox = new InboxState(api, () => ws);
  await inbox.load();
  expect(calls).toEqual([undefined, "200", "400"]);
  expect(inbox.items).toHaveLength(500);
  expect(inbox.mineCount).toBe(500);
  let finish!: (v: unknown) => void;
  const late = new InboxState(
    {
      call: () =>
        new Promise((r) => {
          finish = r;
        }),
    } as unknown as ApiClient,
    () => ws,
  );
  const loading = late.load();
  ws = "ws_111111111111" as WorkspaceKey;
  late.reset();
  finish({ items: all.slice(0, 200), next: null });
  await loading;
  expect(late.items).toEqual([]);
  expect(late.loaded).toBe(false);
});
