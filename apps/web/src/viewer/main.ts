/**
 * Entry of the export viewer (`vite.viewer.config.ts` builds it to ONE IIFE + ONE stylesheet that the exporter
 * inlines). Reads `<script type="application/json" id="mitori-export">` (the `ViewerPayload`, plain JSON or
 * gzip+base64), mounts the Reader. No network: the CSP of the file forbids it, and nothing here asks.
 */
import "../shell/styles/tokens.css";
import "../shell/styles/base.css";
import "../shell/styles/prose.css";
import "../shell/styles/diagram.css";
import "../shell/styles/levels.css";
import "../map/plan.css";
import "./viewer.css";
import { mount } from "svelte";
import type { ViewerPayload } from "../contract.ts";
import { catalogs } from "./catalogs.ts";
import { decodeExportPayload } from "./decode.ts";
import { ViewerState } from "./state.svelte.ts";
import Viewer from "./Viewer.svelte";

/** Failure text of a file whose payload cannot be read; returns false so `boot` can `return fail(...)`-style exit. */
function fail(reason: string): false {
  // the static old-browser fallback is also a `.viewer-error`: once the viewer reports, it must be the only one
  document.getElementById("oldbrowser")?.remove();
  const app = document.getElementById("app")!;
  const ja = !/^en/i.test(navigator.language || "ja");
  app.innerHTML = `<div class="viewer-error"><h1>${ja ? "このファイルを開けませんでした" : "This file could not be opened"}</h1><p>${
    ja
      ? "mitori の書き出しが壊れているか、新しすぎる形式です。書き出し直してください。"
      : "The mitori export is damaged or newer than this viewer. Export it again."
  }</p><p><code></code></p></div>`;
  const code = app.querySelector("code");
  if (code) code.textContent = reason;
  return false;
}

async function boot(): Promise<boolean> {
  const el = document.getElementById("mitori-export");
  if (!el) return fail("missing payload");
  // a gzip payload needs a modern browser: without a gzip `DecompressionStream` the exporter-rendered
  // old-browser message is unhidden instead of a blank page (no `data-encoding` = the plain-JSON embedding)
  const encoding = el.dataset.encoding;
  if (encoding && typeof DecompressionStream === "undefined") {
    document.getElementById("oldbrowser")?.removeAttribute("hidden");
    return false;
  }
  // every failure after this point (a damaged body, a newer format, a body without the document
  // shape the Reader needs) shows the failure text instead of a blank page
  try {
    const payload: ViewerPayload = await decodeExportPayload(el.textContent!, encoding);
    if (payload.format !== "mitori.export/1") return fail(`unsupported format ${payload.format}`);
    const target = document.getElementById("app");
    if (!target) return false;
    const state = new ViewerState(payload, catalogs);
    mount(Viewer, { target, props: { v: state } });
    return true;
  } catch {
    return fail("payload is not valid JSON");
  }
}

boot();
