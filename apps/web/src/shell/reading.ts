/**
 * The reading path of the tab (ux.md §4.3.8 / §7.2): chosen in the rail card, kept in `sessionStorage`
 * `mitori:path:<ws>`, default `30min` (else the outline's first path). Before generation there is no path to
 * follow: the rail shows 「生成すると30分コースが使えます」 instead (§4.2.1).
 */
import type { DocOutline, ReadingPath, SectionId, WorkspaceKey } from "@mitori/core";
import { getItem, STORAGE_KEYS, setItem } from "./storage.ts";

export const DEFAULT_PATH = "30min";

export function selectedPath(outline: Pick<DocOutline, "manifest" | "readingPaths"> | null, ws: WorkspaceKey | null): ReadingPath | null {
  if (!outline || !ws || !outline.manifest.generatedAt) return null;
  const id = getItem("session", STORAGE_KEYS.path(ws)) ?? DEFAULT_PATH;
  return outline.readingPaths.find((p) => p.id === id) ?? outline.readingPaths[0] ?? null;
}

export function choosePath(ws: WorkspaceKey, id: string): void {
  setItem("session", STORAGE_KEYS.path(ws), id);
}

/**
 * The default path as planned before generation (CR m1-103): its step count, the nominal minutes of its id
 * (`30min` ⇒ 30) or its estimated reading time when that is larger, and the first section. Null when the doc is
 * generated (then {@link selectedPath} applies) or the outline has no such path.
 */
export function plannedPath(outline: Pick<DocOutline, "manifest" | "readingPaths"> | null): { steps: number; minutes: number; first: SectionId } | null {
  if (!outline || outline.manifest.generatedAt) return null;
  const p = outline.readingPaths.find((x) => x.id === DEFAULT_PATH);
  const first = p?.steps[0]?.section;
  if (!p || !first) return null;
  const nominal = Number(/^(\d+)min$/.exec(p.id)?.[1] ?? 0);
  return { steps: p.steps.length, minutes: Math.max(nominal, Math.round(p.readingSec / 60)), first };
}
