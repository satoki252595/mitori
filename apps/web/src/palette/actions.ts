/**
 * Client operation items of ⌘K (kind `a`, ux.md §4.10): label from the catalog, aliases in both languages + the
 * id words so `>theme` / `>テーマ` both hit. `run` executes against the stores.
 */
import type { PaletteActionItem } from "../contract.ts";
import { type Stores, setReaderLevel } from "../stores/app.svelte.ts";

export interface ActionDef {
  id: string;
  run: (s: Stores) => void;
  when?: (s: Stores) => boolean;
}

const ws = (s: Stores) => s.workspace.key;
const has = (s: Stores) => s.workspace.key !== null;

export const ACTIONS: readonly ActionDef[] = [
  { id: "action.goMap", run: (s) => ws(s) && void s.router.go({ name: "map", ws: ws(s) as `ws_${string}` }), when: has },
  { id: "action.goDoc", run: (s) => ws(s) && void s.router.go({ name: "doc", ws: ws(s) as `ws_${string}`, section: "s0" }), when: has },
  { id: "action.goInbox", run: (s) => ws(s) && void s.router.go({ name: "inbox", ws: ws(s) as `ws_${string}`, view: "mine" }), when: has },
  { id: "action.goReview", run: (s) => ws(s) && void s.router.go({ name: "reviewNext", ws: ws(s) as `ws_${string}` }), when: has },
  { id: "action.goGen", run: (s) => ws(s) && void s.router.go({ name: "gen", ws: ws(s) as `ws_${string}` }), when: has },
  { id: "action.goSettings", run: (s) => void s.router.go({ name: "settings" }) },
  { id: "action.openWorkspace", run: (s) => void s.router.go({ name: "launcher" }) },
  { id: "action.levelNewcomer", run: (s) => setReaderLevel(s, "newcomer") },
  { id: "action.levelStandard", run: (s) => setReaderLevel(s, "standard") },
  { id: "action.levelExpert", run: (s) => setReaderLevel(s, "expert") },
  { id: "action.themeLight", run: (s) => s.prefs.setTheme("light") },
  { id: "action.themeDark", run: (s) => s.prefs.setTheme("dark") },
  { id: "action.themeSystem", run: (s) => s.prefs.setTheme("system") },
  { id: "action.langJa", run: (s) => s.prefs.setLang("ja") },
  { id: "action.langEn", run: (s) => s.prefs.setLang("en") },
  { id: "action.generate", run: (s) => ws(s) && void s.router.go({ name: "map", ws: ws(s) as `ws_${string}` }), when: has },
  {
    id: "action.textView",
    run: (s) => ws(s) && void s.router.go({ name: "map", ws: ws(s) as `ws_${string}`, textView: true }).then(() => (s.ui.textViewOpen = true)),
    when: has,
  },
  { id: "action.toggleCites", run: (s) => (s.ui.showCites = !s.ui.showCites) },
  { id: "action.singleKeys", run: (s) => s.prefs.setSingleKeys(!s.prefs.singleKeys) },
  { id: "action.help", run: (s) => (s.ui.helpOpen = true) },
];

export function actionItems(t: (k: string) => string, s: Stores): PaletteActionItem[] {
  return ACTIONS.filter((a) => !a.when || a.when(s)).map((a) => ({
    k: "a",
    i: a.id,
    l: t(`palette.${a.id}`),
    al: [t(`palette.${a.id}.alias`), a.id.replace(/^action\./, "")],
  }));
}

export function runAction(id: string, s: Stores): boolean {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) return false;
  a.run(s);
  return true;
}
