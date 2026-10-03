/**
 * Entry of the export viewer (`vite.viewer.config.ts` builds it to ONE IIFE + ONE stylesheet that the exporter
 * inlines). Reads `<script type="application/json" id="mitori-export">` (the `ViewerPayload`), mounts the Reader.
 * No network: the CSP of the file forbids it, and nothing here asks.
 */
import "../shell/styles/tokens.css";
import "../shell/styles/base.css";
import "../shell/styles/prose.css";
import "../shell/styles/levels.css";
import "../map/plan.css";
import "./viewer.css";
import { mount } from "svelte";
import type { ViewerPayload } from "../contract.ts";
import { catalogs } from "./catalogs.ts";
import { ViewerState } from "./state.svelte.ts";
import Viewer from "./Viewer.svelte";

/** Failure text of a file whose payload cannot be read; returns false so `boot` can `return fail(...)`-style exit. */
function fail(reason: string): false {
  const app = document.getElementById("app");
  if (!app) return false;
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

function boot(): boolean {
  const el = document.getElementById("mitori-export");
  if (!el) return fail("missing payload");
  let payload: ViewerPayload;
  try {
    payload = JSON.parse(el.textContent ?? "") as ViewerPayload;
  } catch {
    return fail("payload is not valid JSON");
  }
  if (payload.format !== "mitori.export/1") return fail(`unsupported format ${String(payload.format)}`);
  const target = document.getElementById("app");
  if (!target) return false;
  const state = new ViewerState(payload, catalogs);
  target.textContent = "";
  mount(Viewer, { target, props: { v: state } });
  return true;
}

boot();
