/**
 * ⌘K 「AI に聞く」 (NC-09): a question that the document does not answer by text match goes to the review loop as an
 * Explain draft — anchored on the block the best text hit points at (its context travels with the question), or on
 * §0's first paragraph when nothing matched. The Composer opens with the question typed in and NOTHING is sent: the
 * user sees the estimate and presses send (the loop's usual gate).
 */
import { loadExtensions } from "../shell/ext.ts";
import type { Stores } from "../stores/app.svelte.ts";
import { type AskAnchor, summaryAnchor } from "./anchor.ts";

export type { AskAnchor } from "./anchor.ts";

/** Navigate to the anchor, make sure the loop UI is there, open the Explain Composer with `question`. */
export async function askAi(s: Stores, question: string, at: AskAnchor | null): Promise<boolean> {
  const ws = s.workspace.key;
  const anchor = at ?? summaryAnchor(s.doc.outline);
  if (!ws || !anchor || !question.trim()) return false;
  // the loop chunk and the page load in parallel; the Composer needs both (its target is read from the DOM)
  const loop = loadExtensions(s);
  await s.router.go({ name: "doc", ws, section: anchor.section, block: anchor.block });
  await loop;
  window.dispatchEvent(new CustomEvent("mitori:compose", { detail: { block: anchor.block, claim: null, intent: "question", body: question.trim() } }));
  return true;
}
