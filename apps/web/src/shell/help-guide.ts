/**
 * 「この画面でできること」 (NC-13, ux.md §4.11): the three steps of each screen, as catalog keys
 * `help.guide.<step>.t` / `.d`. The Reader's are the concept itself: read → select and ask → check and accept.
 * Pure.
 */
import type { AppRouteName } from "../contract.ts";

const GUIDES = {
  doc: ["read", "ask", "accept"],
  map: ["mapRoom", "mapOpen", "mapGen"],
  review: ["reviewSee", "reviewPick", "reviewAccept"],
  inbox: ["inboxFilter", "inboxOpen", "inboxSend"],
  code: ["codeRead", "ask", "accept"],
} as const;

export type GuideStep = (typeof GUIDES)[keyof typeof GUIDES][number];

/** The steps of the screen of `route` (screens without their own: the Reader's, where the loop starts). */
export function guideOf(route: AppRouteName): readonly GuideStep[] {
  switch (route) {
    case "map":
      return GUIDES.map;
    case "review":
    case "reviewNext":
      return GUIDES.review;
    case "inbox":
      return GUIDES.inbox;
    case "code":
      return GUIDES.code;
    default:
      return GUIDES.doc;
  }
}

/** Every step id (the catalog test checks that each has a title and a description). */
export const GUIDE_STEPS: readonly GuideStep[] = [...new Set(Object.values(GUIDES).flat())];
