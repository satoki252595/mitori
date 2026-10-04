// The screens the a11y specs walk (testing spec §5.4: S1 map, S2 Reader, light and dark) on the real daemon with the
// go-small fixture, and the in-page probes that axe does not have (text size, target size — WCAG 2.5.8).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestDaemon } from "@mitori/testkit";
import type { Page } from "@playwright/test";

export interface Screen {
  name: string;
  /** Navigate there (after login) and wait until it is painted. */
  open(page: Page, d: TestDaemon): Promise<void>;
}

const bearer = (d: TestDaemon) => {
  const { token } = JSON.parse(readFileSync(join(d.home.dir, "daemon.json"), "utf8")) as { token: string };
  return { authorization: `Bearer ${token}`, "x-mitori-client": "cli/a11y" };
};

/** The workspace the fixture daemon opened (the registry token is a bearer; the printed URL is not used). */
async function wsOf(d: TestDaemon): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const list = (await (await fetch(`${d.url}/api/v1/workspaces`, { headers: bearer(d) })).json()) as { info: { key: string }; state: string }[];
    const ready = list.find((w) => w.state === "ready");
    if (ready) return ready.info.key;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the fixture workspace never became ready");
}

const waitMark = (page: Page, name: string) =>
  page.waitForFunction((n) => performance.getEntriesByName(n, "mark").length > 0, name, { timeout: 30_000, polling: 25 });

/** A fresh login nonce for `path` (`POST /auth/nonce`, as the CLI does) opened in the page: the tab then holds a session. */
async function loginTo(page: Page, d: TestDaemon, path: string): Promise<void> {
  const res = await fetch(`${d.url}/api/v1/auth/nonce`, {
    method: "POST",
    headers: { ...bearer(d), "content-type": "application/json" },
    body: JSON.stringify({ to: path }),
  });
  if (!res.ok) throw new Error(`POST /auth/nonce → ${res.status}`);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
}

export const SCREENS: readonly Screen[] = [
  {
    name: "S1 map",
    async open(page, d) {
      await loginTo(page, d, `/w/${await wsOf(d)}`);
      await waitMark(page, "mitori:map:painted");
    },
  },
  {
    name: "S2 Reader",
    async open(page, d) {
      await loginTo(page, d, `/w/${await wsOf(d)}/doc/s3`);
      await waitMark(page, "mitori:section:rendered");
    },
  },
];

export interface ProbeResult {
  /** Visible text below 11 px, or control labels below 12 px (ui.a11y.textSize). */
  smallText: string[];
  /** Pointer targets smaller than 24×24 px without 24 px of spacing to the next target (ui.a11y.target). */
  smallTargets: string[];
}

/** In-page probes (run through `page.evaluate`). */
export async function probe(page: Page): Promise<ProbeResult> {
  return page.evaluate(() => {
    const visible = (el: Element) => (el as HTMLElement).checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true;
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}` : ""}`;
    const smallText: string[] = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.nodeValue ?? "").trim() || !visible(el)) continue;
      seen.add(el);
      if (el.closest("svg")) continue; // diagram labels scale with the zoom (map/render.ts keeps them ≥ 11 px on screen)
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue; // visually hidden (sr-only): read, not seen
      const px = Number.parseFloat(getComputedStyle(el).fontSize);
      // ux §13.2: a control's LABEL (its largest text — the name, not a count or a key hint beside it) ≥ 12 px
      const control = el.closest("button, a[href], [role=button], label, select");
      let isLabel = false;
      if (control) {
        let max = 0;
        for (const t of control.querySelectorAll("*")) if ((t.textContent ?? "").trim()) max = Math.max(max, Number.parseFloat(getComputedStyle(t).fontSize));
        isLabel = control === el || px >= Math.max(max, Number.parseFloat(getComputedStyle(control).fontSize));
      }
      if (px < (isLabel ? 12 : 11)) smallText.push(`${label(el)} ${px}px "${(n.nodeValue ?? "").trim().slice(0, 20)}"`);
    }
    const targets = [...document.querySelectorAll("button, a[href], [role=button], input, select, [tabindex='0']")].filter(visible);
    const rects = targets.map((t) => t.getBoundingClientRect()).map((r) => ({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }));
    const smallTargets: string[] = [];
    rects.forEach((r, i) => {
      if (r.w === 0 || r.h === 0 || (r.w >= 24 && r.h >= 24)) return;
      const t = targets[i] as Element;
      if (t.closest("p, li, td") && t.tagName === "A") return; // inline links in text are exempt (2.5.8 "inline")
      const near = rects.some((o, j) => j !== i && o.w > 0 && Math.hypot(o.cx - r.cx, o.cy - r.cy) < 24);
      if (near) smallTargets.push(`${label(t)} ${Math.round(r.w)}×${Math.round(r.h)}`);
    });
    return { smallText, smallTargets };
  });
}
