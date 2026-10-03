/**
 * @wp10a AC-U-W01 viewport matrix (ux.md §3.1 / §4.4, UXP-03) for the WP-10a screens: S1, S2 margin, S2 code — at
 * 1024×768 · 1180×820 · 1194×834 · 1280×720 · 1280×800 · 1366×768 · 1440×900 with a 17 px classic scrollbar:
 * no horizontal page scroll, the Reader measure ≥ 34 full-width characters, the rail becomes a drawer below
 * rail + 672 + 332, and every header control stays inside the viewport. (S4 Inbox / S5 Review rows belong to WP-10b.)
 */
import { expect, type Page, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

const VIEWPORTS = [
  [1024, 768],
  [1180, 820],
  [1194, 834],
  [1280, 720],
  [1280, 800],
  [1366, 768],
  [1440, 900],
] as const;

const SCREENS = [
  { name: "S1", path: `/w/${WS}`, mark: "mitori:map:painted" },
  { name: "S2 margin", path: `/w/${WS}/doc/s3`, mark: "mitori:section:rendered" },
  { name: "S2 code", path: `/w/${WS}/doc/s3?ctx=code&pin=internal/daemon/daemon.go:178-193`, mark: "mitori:section:rendered" },
] as const;

/** Classic (non-overlay) 17 px scrollbars, as on Windows / macOS "always show scroll bars". */
async function classicScrollbars(page: Page) {
  await page.addInitScript(() => {
    const st = document.createElement("style");
    st.textContent = "html{overflow-y:scroll}::-webkit-scrollbar{width:17px;height:17px;background:#ddd}::-webkit-scrollbar-thumb{background:#999}";
    document.documentElement.appendChild(st);
  });
}

for (const [w, h] of VIEWPORTS) {
  for (const sc of SCREENS) {
    test(`@wp10a AC-U-W01 ${sc.name} ${w}×${h}: no horizontal scroll, measure ≥ 34 字, controls in view`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await classicScrollbars(page);
      await configure({});
      await page.goto(sc.path);
      await waitMark(page, sc.mark);
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const se = document.scrollingElement as HTMLElement;
        const body = document.querySelector(".body") as HTMLElement | null;
        const vw = document.documentElement.clientWidth;
        const off: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(".hdr button, .hdr a, .hdr .seg, .status > *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || getComputedStyle(el).visibility === "hidden") continue;
          if (r.right > vw + 0.5 || r.left < -0.5) off.push(`${el.className || el.tagName} ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        // header columns: the content of each side never runs into the tabs
        const extent = (sel: string) => {
          let l = Number.POSITIVE_INFINITY;
          let r = Number.NEGATIVE_INFINITY;
          for (const el of document.querySelectorAll<HTMLElement>(`${sel} > *`)) {
            const b = el.getBoundingClientRect();
            if (b.width === 0) continue;
            l = Math.min(l, b.left);
            r = Math.max(r, b.right);
          }
          return [l, r] as const;
        };
        const [, lR] = extent(".hdr-l");
        const [mL, mR] = extent(".hdr-m .tabs");
        const [rL] = extent(".hdr-r");
        if (lR > mL + 0.5 || mR > rL + 0.5) off.push(`header overlap l..${Math.round(lR)} m${Math.round(mL)}..${Math.round(mR)} r${Math.round(rL)}..`);
        const prose = document.querySelector<HTMLElement>(".reader-root .blk[data-kind='prose'] > .mb");
        const fs = prose ? parseFloat(getComputedStyle(prose).fontSize) : 0;
        return {
          hScroll: se.scrollWidth - se.clientWidth,
          bodyW: body?.clientWidth ?? 0,
          rail: document.querySelector<HTMLElement>(".rail")?.dataset.mode ?? null,
          measure: prose && fs ? prose.getBoundingClientRect().width / fs : null,
          off,
        };
      });
      expect(m.hScroll, "horizontal page scroll").toBeLessThanOrEqual(0);
      expect(m.off, "header / status controls outside the viewport").toEqual([]);
      if (sc.name !== "S1") {
        expect(m.measure, "Reader line length in full-width characters").not.toBeNull();
        expect(m.measure ?? 0).toBeGreaterThanOrEqual(34);
        // the rail turns into a drawer when the grid container cannot hold rail + 672 + margin column
        // (wide ≥ 1281: 248 + 368, laptop: 228 + 332)
        const needs = m.bodyW >= 1281 ? 248 + 672 + 368 : 228 + 672 + 332;
        if (sc.name === "S2 margin") expect(m.rail).toBe(m.bodyW < needs ? "drawer" : "inline");
      }
    });
  }
}
