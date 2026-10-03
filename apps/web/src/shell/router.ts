/**
 * History routes (contract §1, ux.md §2.2): pure `parse` / `href`. Path parts come from core `HREFS` (the same
 * strings the doc renderer, the palette index and the exporter emit). `parse` never throws: an unknown path or an
 * invalid required parameter ⇒ launcher; an invalid optional value is dropped.
 */
import { HREFS, isId, type LineNo, type RepoPath, type SectionId } from "@mitori/core";
import type { CodePin, CtxMode, InboxView, RouteState, SettingsTab, WsSettingsTab, ZoomStage } from "../contract.ts";

const SECTION_RE = /^(?:s(?:[0-9]|1[0-3])|appendix)(?:\/[^/].*)?$/u;
const ZOOMS: readonly ZoomStage[] = ["Z0", "Z1", "Z2", "Z3"];
const CTX: readonly CtxMode[] = ["margin", "code", "review"];
const INBOX: readonly InboxView[] = ["all", "mine", "working", "failed", "outdated", "draft", "resolved", "uncommitted"];
const SETTINGS_TABS: readonly SettingsTab[] = ["general", "engines", "models", "budget", "review", "shortcuts", "privacy", "integrations", "about"];
const WS_TABS: readonly WsSettingsTab[] = ["workspace", "trust", "repo", "export"];

export function isSectionId(s: string): s is SectionId {
  return SECTION_RE.test(s) && !s.endsWith("/") && !s.includes("//");
}

function isRepoPath(p: string): p is RepoPath {
  return p.length > 0 && !p.startsWith("/") && !p.split("/").some((s) => s === "" || s === "." || s === "..");
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function decodeSegs(segs: readonly string[]): string | null {
  try {
    return segs.map((s) => decodeURIComponent(s)).join("/");
  } catch {
    return null;
  }
}

function oneOf<T extends string>(v: string | null, all: readonly T[]): T | undefined {
  return v !== null && (all as readonly string[]).includes(v) ? (v as T) : undefined;
}

function parsePin(v: string | null): CodePin | undefined {
  if (!v) return undefined;
  const i = v.lastIndexOf(":");
  if (i <= 0) return undefined;
  const path = v.slice(0, i);
  const m = /^(\d+)-(\d+)$/.exec(v.slice(i + 1));
  if (!m || !isRepoPath(path)) return undefined;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start >= 1 && end >= start ? { path, start, end } : undefined;
}

function parseLines(hash: string): { start: LineNo; end: LineNo } | undefined {
  const m = /^#L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  return start >= 1 && end >= start ? { start, end } : undefined;
}

/** Parse pathname + search + hash. */
export function parseRoute(url: string): RouteState {
  let u: URL;
  try {
    u = new URL(url, "http://x");
  } catch {
    return { name: "launcher" };
  }
  const q = u.searchParams;
  const segs = u.pathname.split("/").slice(1);
  if (segs[segs.length - 1] === "" && segs.length > 1) segs.pop();
  if (segs.length === 1 && segs[0] === "settings") {
    const tab = oneOf(q.get("tab"), SETTINGS_TABS);
    return tab ? { name: "settings", tab } : { name: "settings" };
  }
  if (segs[0] !== "w" || segs.length < 2) return { name: "launcher" };
  const ws = segs[1] ?? "";
  if (!isId("workspace", ws)) return { name: "launcher" };
  const kind = segs[2];
  const rest = segs.slice(3);
  switch (kind) {
    case undefined: {
      const r: RouteState & { name: "map" } = { name: "map", ws };
      const room = q.get("room");
      if (room && /^[A-Za-z0-9_-]{1,80}$/.test(room)) r.room = room;
      const z = oneOf(q.get("z"), ZOOMS);
      if (z) r.zoom = z;
      const flow = q.get("flow");
      if (flow && isSectionId(flow)) r.flow = flow;
      if (q.get("text") === "1") r.textView = true;
      return r;
    }
    case "doc": {
      const section = decodeSegs(rest);
      if (section === null || !isSectionId(section)) return { name: "launcher" };
      const r: RouteState & { name: "doc" } = { name: "doc", ws, section };
      const block = u.hash.slice(1);
      if (isId("block", block)) r.block = block;
      const ctx = oneOf(q.get("ctx"), CTX);
      if (ctx) r.ctx = ctx;
      const pin = parsePin(q.get("pin"));
      if (pin) r.pin = pin;
      const th = q.get("th");
      if (isId("thread", th)) r.thread = th;
      return r;
    }
    case "code": {
      const path = decodeSegs(rest);
      if (path === null || !isRepoPath(path)) return { name: "launcher" };
      const r: RouteState & { name: "code" } = { name: "code", ws, path };
      const range = parseLines(u.hash);
      if (range) r.range = range;
      return r;
    }
    case "inbox": {
      if (rest.length) return { name: "launcher" };
      const r: RouteState & { name: "inbox" } = { name: "inbox", ws, view: oneOf(q.get("f"), INBOX) ?? "mine" };
      const sel = q.get("sel");
      if (sel && sel.length <= 120) r.sel = sel;
      return r;
    }
    case "review": {
      if (rest.length === 0) return { name: "reviewNext", ws };
      const job = rest[0];
      if (rest.length !== 1 || !isId("job", job)) return { name: "launcher" };
      const r: RouteState & { name: "review" } = { name: "review", ws, job };
      if (q.get("wide") === "1") r.wide = true;
      const hunk = q.get("hunk");
      if (hunk && /^.+:\d+$/.test(hunk)) r.hunk = hunk as `${string}:${number}`;
      return r;
    }
    case "threads": {
      const th = rest[0];
      return rest.length === 1 && isId("thread", th) ? { name: "thread", ws, th } : { name: "launcher" };
    }
    case "glossary": {
      const term = q.get("term");
      return isId("glossary", term) ? { name: "glossary", ws, term } : { name: "glossary", ws };
    }
    case "decisions": {
      const dc = q.get("dc");
      return isId("decision", dc) ? { name: "decisions", ws, dc } : { name: "decisions", ws };
    }
    case "gen": {
      const run = q.get("run");
      return isId("genRun", run) ? { name: "gen", ws, run } : { name: "gen", ws };
    }
    case "settings": {
      const tab = oneOf(q.get("tab"), WS_TABS);
      return tab ? { name: "wsSettings", ws, tab } : { name: "wsSettings", ws };
    }
    default:
      return { name: "launcher" };
  }
}

function withQuery(path: string, q: [string, string | undefined][], hash = ""): string {
  const parts = q.filter((e): e is [string, string] => e[1] !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return `${path}${parts.length ? `?${parts.join("&")}` : ""}${hash}`;
}

/** Serialize (inverse of {@link parseRoute} for every valid state: `parse(href(s))` deep-equals `s`). */
export function hrefRoute(to: RouteState): string {
  switch (to.name) {
    case "launcher":
      return "/";
    case "settings":
      return withQuery("/settings", [["tab", to.tab]]);
    case "map":
      return withQuery(HREFS.map(to.ws), [
        ["room", to.room],
        ["z", to.zoom],
        ["flow", to.flow],
        ["text", to.textView ? "1" : undefined],
      ]);
    case "doc":
      return withQuery(
        HREFS.doc(to.ws, to.section),
        [
          ["ctx", to.ctx],
          ["pin", to.pin ? `${to.pin.path}:${to.pin.start}-${to.pin.end}` : undefined],
          ["th", to.thread],
        ],
        to.block ? `#${to.block}` : "",
      );
    case "code":
      return to.range ? HREFS.code(to.ws, to.path, to.range.start, to.range.end) : HREFS.code(to.ws, to.path);
    case "inbox":
      return withQuery(`/w/${to.ws}/inbox`, [
        ["f", to.view],
        ["sel", to.sel],
      ]);
    case "review":
      return withQuery(HREFS.review(to.ws, to.job), [
        ["wide", to.wide ? "1" : undefined],
        ["hunk", to.hunk],
      ]);
    case "reviewNext":
      return `/w/${to.ws}/review`;
    case "thread":
      return HREFS.thread(to.ws, to.th);
    case "glossary":
      return withQuery(`/w/${to.ws}/glossary`, [["term", to.term]]);
    case "decisions":
      return withQuery(`/w/${to.ws}/decisions`, [["dc", to.dc]]);
    case "gen":
      return withQuery(`/w/${to.ws}/gen`, [["run", to.run]]);
    case "wsSettings":
      return withQuery(`/w/${to.ws}/settings`, [["tab", to.tab]]);
  }
}

/** `encodeURIComponent` per segment (exported for tests). */
export const encodePath = enc;

/** View kind used for `ROUTE_SCOPES` (S2 with ctx=review ⇒ `docReview`). */
export function viewKind(r: RouteState): "launcher" | "map" | "doc" | "docReview" | "code" | "review" | "inbox" | "other" {
  switch (r.name) {
    case "launcher":
      return "launcher";
    case "map":
      return "map";
    case "doc":
      return r.ctx === "review" ? "docReview" : "doc";
    case "code":
      return "code";
    case "review":
      return "docReview";
    case "inbox":
      return "inbox";
    default:
      return "other";
  }
}
