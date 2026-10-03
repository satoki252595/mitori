// `ui.*` page helpers (testing spec §5.4, §6.4, §6.6) over a Playwright page. Everything runs in the page through
// `evaluate`; nothing here knows about the app except the code-line selectors and the `mitori:` mark prefix.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { MitoriError } from "@mitori/core";
import type { PageLike } from "../contract.ts";
import { OBSERVERS_SOURCE, type RawInteraction } from "./observers.ts";
import { asPwPage, cdp } from "./page.ts";

/** Rule tags of the a11y checks (§5.4). */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function ensureObservers(page: PageLike): Promise<void> {
  await asPwPage(page).evaluate(OBSERVERS_SOURCE);
}

export async function domNodes(page: PageLike): Promise<number> {
  return asPwPage(page).evaluate<number>("document.getElementsByTagName('*').length");
}

/** `.cm-line` (CodeMirror) + `pre.mcode .line` (static code blocks); the union, so an element is never counted twice. */
export async function mountedCodeLines(page: PageLike): Promise<number> {
  return asPwPage(page).evaluate<number>("document.querySelectorAll('.cm-line, pre.mcode .line').length");
}

/** One entry per interaction: the longest event-timing entry of each `interactionId` (what INP is built from). */
export async function interactions(page: PageLike): Promise<readonly { interactionId: number; name: string; duration: number }[]> {
  await ensureObservers(page);
  const raw = await asPwPage(page).evaluate<RawInteraction[]>("window.__mitoriPerf.events.slice()");
  const best = new Map<number, RawInteraction>();
  for (const e of raw) {
    const cur = best.get(e.interactionId);
    if (!cur || e.duration > cur.duration) best.set(e.interactionId, e);
  }
  return [...best.values()].sort((a, b) => a.startTime - b.startTime).map(({ interactionId, name, duration }) => ({ interactionId, name, duration }));
}

export async function marks(page: PageLike, prefix = "mitori:"): Promise<readonly { name: string; startTime: number; duration: number }[]> {
  return asPwPage(page).evaluate<{ name: string; startTime: number; duration: number }[]>(
    `(() => {
      const prefix = ${JSON.stringify(prefix)};
      return [...performance.getEntriesByType("mark"), ...performance.getEntriesByType("measure")]
        .filter((e) => e.name.startsWith(prefix))
        .map((e) => ({ name: e.name, startTime: e.startTime, duration: e.duration }))
        .sort((a, b) => a.startTime - b.startTime);
    })()`,
  );
}

/** Sum of layout-shift values that happened without recent input. */
export async function cls(page: PageLike): Promise<number> {
  await ensureObservers(page);
  return asPwPage(page).evaluate<number>("window.__mitoriPerf.cls");
}

/** WCAG 2.4.11: the focused element's centre is not covered by an unrelated element. No focus ⇒ true. */
export async function focusNotObscured(page: PageLike): Promise<boolean> {
  return asPwPage(page).evaluate<boolean>(
    `(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return true;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    })()`,
  );
}

let axeSource: string | undefined;
function loadAxeSource(): string {
  if (axeSource) return axeSource;
  try {
    axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
    return axeSource;
  } catch (err) {
    throw new MitoriError(
      "E_UNSUPPORTED",
      "ui.axe needs the `axe-core` package: add it (exact version) to @mitori/testkit devDependencies — see docs/design/cr-requests/WP-12.md",
      { cause: err },
    );
  }
}

/** Serious / critical axe violations for the whole page or the subtree under `opts.include` (a CSS selector). */
export async function axe(page: PageLike, opts?: { include?: string }): Promise<readonly { id: string; impact: string; nodes: number }[]> {
  const p = asPwPage(page);
  // a page that already ships `window.axe` (an app test hook, or a stub) is used as it is
  if (!(await p.evaluate<boolean>("typeof window.axe === 'object'"))) await p.evaluate(loadAxeSource());
  const found = await p.evaluate<{ id: string; impact: string | null; nodes: number }[]>(
    `(async () => {
      const include = ${JSON.stringify(opts?.include ?? null)};
      const res = await window.axe.run(include ? { include: [include] } : document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} } });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    })()`,
  );
  return found.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, impact: v.impact as string, nodes: v.nodes }));
}

/** CDP CPU throttling (rate 4 = 4× slower; 1 resets). Chromium only; the session stays attached for the page's lifetime. */
export async function throttleCpu(page: PageLike, rate: number): Promise<void> {
  if (!(rate >= 1)) throw new MitoriError("E_INVALID_INPUT", `CPU throttling rate must be ≥ 1, got ${rate}`);
  await (await cdp(asPwPage(page))).send("Emulation.setCPUThrottlingRate", { rate });
}
