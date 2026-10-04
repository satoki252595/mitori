/**
 * The reading path of the tab (ux.md §4.3.8 / §7.2): chosen in the rail card, kept in `sessionStorage`
 * `mitori:path:<ws>`; by default the 5-minute course at the 「初めて」 level (NC-08), else the 30-minute one (else the
 * outline's first path). Before generation there is no path to follow: the rail shows 「生成すると30分コースが
 * 使えます」 instead (§4.2.1).
 *
 * Progress (NC-15): a section read counts for EVERY path that stops there (you read it, whichever course you were
 * on) — `mitori:read:<ws>:_any`, merged with the per-path maps of older versions. Names follow the UI language
 * (the server titles follow the doc's), and a timed course whose stops really take much longer or shorter than
 * its nominal time is named by the real time (「約11分コース」).
 */
import type { DocOutline, ReaderLevel, ReadingPath, SectionId, WorkspaceKey } from "@mitori/core";
import { getItem, getJson, STORAGE_KEYS, setItem, setJson } from "./storage.ts";

export const DEFAULT_PATH = "30min";
/** The first-run course (NC-08): §0 → §1 → §2 → §3. */
export const NEWCOMER_PATH = "5min";
/** The ws-wide read map (every path). */
export const ANY_PATH = "_any";
/** Course order: what to suggest after finishing one (ux.md §7.2 「…を読み終えました · 次: …」). */
export const PATH_ORDER = ["5min", "30min", "reviewer", "pm", "sre"] as const;

export function defaultPathId(level?: ReaderLevel): string {
  return level === "newcomer" ? NEWCOMER_PATH : DEFAULT_PATH;
}

export function selectedPath(outline: Pick<DocOutline, "manifest" | "readingPaths"> | null, ws: WorkspaceKey | null, level?: ReaderLevel): ReadingPath | null {
  if (!outline || !ws || !outline.manifest.generatedAt) return null;
  const chosen = getItem("session", STORAGE_KEYS.path(ws));
  const id = chosen ?? defaultPathId(level);
  return (
    outline.readingPaths.find((p) => p.id === id) ??
    (chosen === null ? outline.readingPaths.find((p) => p.id === DEFAULT_PATH) : undefined) ??
    outline.readingPaths[0] ??
    null
  );
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

/** Sections read in `ws` for `pathId`: the ws-wide map ∪ the path's own (older versions wrote per path only). */
export function readMapOf(ws: WorkspaceKey, pathId: string): Record<string, string> {
  return {
    ...(getJson<Record<string, string>>("local", STORAGE_KEYS.read(ws, pathId)) ?? {}),
    ...(getJson<Record<string, string>>("local", STORAGE_KEYS.read(ws, ANY_PATH)) ?? {}),
  };
}

/** Mark a section read (for every path); false when it already was. */
export function markRead(ws: WorkspaceKey, section: SectionId, at: string): boolean {
  const key = STORAGE_KEYS.read(ws, ANY_PATH);
  const cur = getJson<Record<string, string>>("local", key) ?? {};
  if (cur[section]) return false;
  cur[section] = at;
  setJson("local", key, cur);
  return true;
}

const minutes = (sec: number) => Math.max(1, Math.round(sec / 60));

export interface PathProgress {
  read: number;
  total: number;
  /** Minutes of the unread stops (0 once done). */
  leftMin: number;
  /** Minutes of all stops. */
  totalMin: number;
  done: boolean;
  /** First unread stop. */
  next: SectionId | null;
  /** Stops in order with their read state. */
  stops: { section: SectionId; read: boolean; min: number }[];
}

export function pathProgress(path: Pick<ReadingPath, "steps">, read: Record<string, string>, readingSec: (id: SectionId) => number): PathProgress {
  const stops = path.steps.map((st) => ({ section: st.section, read: !!read[st.section], min: minutes(readingSec(st.section)) }));
  const unread = stops.filter((s) => !s.read);
  const sum = (l: typeof stops) => l.reduce((n, s) => n + readingSec(s.section), 0);
  return {
    read: stops.length - unread.length,
    total: stops.length,
    leftMin: unread.length ? minutes(sum(unread)) : 0,
    totalMin: minutes(sum(stops)),
    done: stops.length > 0 && unread.length === 0,
    next: unread[0]?.section ?? null,
    stops,
  };
}

/**
 * The course name in the UI language: `rail.pathName.<id>` for the default paths, the server title otherwise. A
 * timed course (`<n>min`) whose stops take ≥ 1.5× or ≤ 0.5× its nominal time is named by the real time instead
 * (`rail.pathName.timed`), so 「30分コース」 never promises 30 minutes for 11 minutes of reading.
 */
export function pathName(
  path: Pick<ReadingPath, "id" | "title">,
  totalMin: number,
  t: (k: string, p?: Record<string, string | number>) => string,
  has: (k: string) => boolean,
): string {
  const nominal = Number(/^(\d+)min$/.exec(path.id)?.[1] ?? 0);
  if (nominal > 0 && (totalMin >= nominal * 1.5 || totalMin <= nominal * 0.5)) return t("rail.pathName.timed", { min: totalMin });
  const key = `rail.pathName.${path.id}`;
  return has(key) ? t(key) : path.title;
}

/**
 * The UI name of the course `id` of `paths` — the same name the rail card, the §0 welcome card, the map's card and ⌘K
 * show (「約13分コース」 when the 5-minute course really takes 13), or null when the outline has no such course.
 */
export function courseName(
  paths: readonly Pick<ReadingPath, "id" | "title" | "steps">[],
  id: string,
  readingSec: (id: SectionId) => number,
  t: (k: string, p?: Record<string, string | number>) => string,
  has: (k: string) => boolean,
): string | null {
  const p = paths.find((x) => x.id === id);
  return p ? pathName(p, pathProgress(p, {}, readingSec).totalMin, t, has) : null;
}

/** The course to suggest once `cur` is read: the next of {@link PATH_ORDER} that exists and is not read yet. */
export function nextPathAfter(paths: readonly ReadingPath[], cur: string, isDone: (p: ReadingPath) => boolean): ReadingPath | null {
  const order = [...PATH_ORDER, ...paths.map((p) => p.id).filter((id) => !(PATH_ORDER as readonly string[]).includes(id))];
  const at = order.indexOf(cur);
  for (const id of [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))]) {
    const p = paths.find((x) => x.id === id);
    if (p && p.steps.length > 0 && !isDone(p)) return p;
  }
  return null;
}
