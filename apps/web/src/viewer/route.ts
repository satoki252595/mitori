/**
 * Hash routes of the export viewer (a file has no server, so no History routes):
 *   `#/s3`  `#/s6/internal-session`  `#/s3@b_0123abcd` (section + block)  `#/map`  `#/map?room=md_ab12cd34`
 * Anything else (`#c` of a cite chip, an empty hash, an unknown section) is not a route: the caller keeps the
 * current view. Pure.
 */
import type { BlockId, SectionId } from "@mitori/core";

export type Route = { name: "doc"; section: SectionId; block: BlockId | null } | { name: "map"; room: string | null };

const BLOCK = /^b_[0-9a-z]{8}$/;

export function parseHash(hash: string, known: (s: SectionId) => boolean): Route | null {
  if (!hash.startsWith("#/")) return null;
  let rest = hash.slice(2);
  let q = "";
  const qi = rest.indexOf("?");
  if (qi >= 0) {
    q = rest.slice(qi + 1);
    rest = rest.slice(0, qi);
  }
  if (rest === "map") return { name: "map", room: new URLSearchParams(q).get("room") };
  let block: BlockId | null = null;
  const at = rest.indexOf("@");
  if (at >= 0) {
    const b = rest.slice(at + 1);
    if (BLOCK.test(b)) block = b as BlockId;
    rest = rest.slice(0, at);
  }
  let section: string;
  try {
    section = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return known(section as SectionId) ? { name: "doc", section: section as SectionId, block } : null;
}

export function formatHash(r: Route): string {
  if (r.name === "map") return r.room ? `#/map?room=${encodeURIComponent(r.room)}` : "#/map";
  return `#/${r.section.split("/").map(encodeURIComponent).join("/")}${r.block ? `@${r.block}` : ""}`;
}

/** `/w/<ws>/doc/<section>#<block>` or `/w/<ws>` (the palette's History hrefs) → a viewer route. */
export function routeOfHref(href: string): Route | null {
  const doc = /^\/w\/[^/]+\/doc\/([^#]*)(?:#(b_[0-9a-z]{8}))?$/.exec(href);
  if (doc) return { name: "doc", section: decodeURIComponent(doc[1] as string) as SectionId, block: (doc[2] as BlockId | undefined) ?? null };
  const map = /^\/w\/[^/?]+(?:\?room=(.*))?$/.exec(href);
  if (map) return { name: "map", room: map[1] ? decodeURIComponent(map[1]) : null };
  return null;
}
