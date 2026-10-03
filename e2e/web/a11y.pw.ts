/**
 * @wp10a a11y probes on S1 / S2 in light and dark (ux.md §13.2 `mitori/faint-surface` probe part, WEB-U-031/032):
 * text painted in `--faint` sits on `--paper` / `--sheet` only, every button and link has an accessible name,
 * no progressbar semantics.
 */
import { expect, type Page, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

async function probe(page: Page) {
  return page.evaluate(() => {
    const rgb = (v: string) => {
      const el = document.createElement("span");
      el.style.color = v;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const root = getComputedStyle(document.documentElement);
    const faint = rgb(root.getPropertyValue("--faint").trim());
    const ok = new Set([rgb(root.getPropertyValue("--paper").trim()), rgb(root.getPropertyValue("--sheet").trim())]);
    const surface = (el: Element | null): string => {
      for (let e = el; e; e = e.parentElement) {
        const b = getComputedStyle(e).backgroundColor;
        if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") return b;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const faintBad: string[] = [];
    let faintSeen = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (!el || !(n.nodeValue ?? "").trim() || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      if (getComputedStyle(el).color !== faint) continue;
      faintSeen++;
      const bg = surface(el);
      if (!ok.has(bg)) faintBad.push(`${el.tagName.toLowerCase()}.${el.className}: "${(n.nodeValue ?? "").trim().slice(0, 24)}" on ${bg}`);
    }
    const unnamed: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], [role=button], [role=radio], input, select")) {
      if (!el.checkVisibility()) continue;
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.getAttribute("title") ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
        el.closest("label")?.textContent ||
        el.textContent;
      if (!label?.trim()) unnamed.push(el.outerHTML.slice(0, 90));
    }
    return { faintBad, faintSeen, unnamed, progress: document.querySelectorAll('[role="progressbar"], progress').length };
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const [name, path, mark] of [
    ["S1", `/w/${WS}`, "mitori:map:painted"],
    ["S2", `/w/${WS}/doc/s3`, "mitori:section:rendered"],
  ] as const) {
    test(`@wp10a a11y ${name} ${scheme}: faint text on paper/sheet only, named controls, no progressbar`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await configure({ generated: name === "S2" });
      await page.goto(path);
      await waitMark(page, mark);
      await page.waitForTimeout(400);
      const r = await probe(page);
      expect(r.faintSeen, "the probe sees --faint text (rail foot, labels)").toBeGreaterThan(0);
      expect(r.faintBad, "--faint text on another surface").toEqual([]);
      expect(r.unnamed, "controls without an accessible name").toEqual([]);
      expect(r.progress).toBe(0);
    });
  }
}
