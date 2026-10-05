import { expect, test } from "bun:test";
import type { ApiClient } from "@mitori/client";
import type { MapView, UiLang, WorkspaceKey } from "@mitori/core";
import { installRunes } from "./__tests__/runes.ts";

installRunes();
const { MapState } = await import("./map.svelte.ts");

test("map presentation is keyed by workspace/locale and only the newest request may replace it", async () => {
  let lang: UiLang = "ja";
  const ws = "ws_000000000000" as WorkspaceKey;
  const pending: { lang: UiLang; finish: (v: MapView) => void }[] = [];
  const api = {
    call: (_: string, req: { query: { svg: boolean; lang: UiLang } }) =>
      new Promise<MapView>((finish) => {
        expect(req.query.svg).toBe(true);
        pending.push({ lang: req.query.lang, finish });
      }),
  } as unknown as ApiClient;
  const state = new MapState(
    api,
    () => ws,
    () => lang,
  );
  const snapshot = (svg: string) => ({ svg, plan: { width: 1, height: 1, rooms: [], zones: [], edges: [] } }) as unknown as MapView;
  const ja = state.load();
  lang = "en";
  const en = state.load();
  pending[1]?.finish(snapshot("en"));
  await en;
  pending[0]?.finish(snapshot("ja"));
  await ja;
  expect(state.view?.svg).toBe("en");
  await state.load();
  expect(pending).toHaveLength(2);
  const old = state.load(true);
  const newer = state.load(true);
  pending[3]?.finish(snapshot("newer"));
  await newer;
  pending[2]?.finish(snapshot("old"));
  await old;
  expect(state.view?.svg).toBe("newer");
  const reset = state.load(true);
  state.reset();
  pending[4]?.finish(snapshot("reset"));
  await reset;
  expect(state.view).toBeNull();
});
