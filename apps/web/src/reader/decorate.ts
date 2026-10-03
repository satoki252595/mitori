/**
 * Per-block client decoration (ux.md §4.3.4 / §12.7), run once per block mount or html change. Everything the
 * client adds INSIDE `.mb` carries `data-mx` (excluded from anchor text, AC-U30): the newcomer "出典 n" button
 * and the claim-check button `button.vsum` on blocks with a problematic claim. Verdict badges stay pseudo-elements.
 */
import type { BlockView, ReaderLevel } from "@mitori/core";

export interface DecorateText {
  citeEnd: (n: number) => string;
  verifyLabel: string;
}

const PROBLEM = new Set(["inferred", "unsupported", "stale"]);

export function decorateBlock(wrapper: HTMLElement, b: BlockView, level: ReaderLevel, text: DecorateText): void {
  const mb = wrapper.querySelector<HTMLElement>(":scope > .mb");
  if (!mb) return;
  // gutter ✓ (shown on hover / ⌥ / expert by CSS)
  const verdicts = b.claimViews.map((c) => c.verdict);
  if (verdicts.length && verdicts.every((v) => v === "verified" || v === "human-verified"))
    wrapper.dataset.v = verdicts.every((v) => v === "human-verified") ? "human" : "verified";
  else delete wrapper.dataset.v;
  // claim spans: screen-reader description of the badge (attribute only)
  for (const span of mb.querySelectorAll<HTMLElement>(".mc[data-verdict]")) {
    const v = span.dataset.verdict ?? "";
    if (PROBLEM.has(v)) span.setAttribute("aria-describedby", `sr-verdict-${v}`);
  }
  // newcomer: paragraph-end "出典 n"
  const cites = mb.querySelectorAll("a.mcite").length;
  if (cites > 0 && !mb.querySelector(".cite-end")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cite-end";
    btn.dataset.mx = "";
    btn.textContent = text.citeEnd(cites);
    const last = mb.lastElementChild;
    (last && /^(P|LI)$/.test(last.tagName) ? last : mb).appendChild(btn);
  }
  // claim check button only when the block has a problematic claim
  if (verdicts.some((v) => PROBLEM.has(v)) && !mb.querySelector("button.vsum")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vsum";
    btn.dataset.mx = "";
    btn.textContent = text.verifyLabel;
    const last = mb.lastElementChild;
    (last && /^(P|LI)$/.test(last.tagName) ? last : (last?.querySelector("li:last-child, p:last-child") ?? mb)).appendChild(btn);
  }
  applyLevel(wrapper, level);
}

/** `<details>` defaults per level: Deep Dive open only for expert, Why open only for newcomer. */
export function applyLevel(root: ParentNode, level: ReaderLevel): void {
  for (const d of root.querySelectorAll<HTMLDetailsElement>("details.mdeep")) d.open = level === "expert";
  for (const d of root.querySelectorAll<HTMLDetailsElement>("details.why")) d.open = level === "newcomer";
}
