/**
 * The viewer bundle of the HTML export (WP-13) as the daemon hands it to `createHtmlExporter`: `gen-assets` builds
 * `apps/web/vite.viewer.config.ts` into the web dist (`/assets/viewer-<hash>.js|css` and `/viewer/viewer.json`, the pointer
 * with the script's sha256), so the compiled binary embeds it with the rest of the web assets. A checkout that never ran
 * `gen-assets` has none: the exporter then refuses with a message that names the fix instead of writing a blank page.
 */
import type { ServerDeps } from "@mitori/server";

export function viewerBundle(assets: ServerDeps["assets"]): ServerDeps["viewerAssets"] {
  const none = { js: "", css: "", jsSha256: "" };
  const seal = assets.get("/viewer/viewer.json");
  if (!seal) return none;
  const dec = new TextDecoder();
  try {
    const m = JSON.parse(dec.decode(seal.raw)) as { js?: string; css?: string; jsSha256?: string };
    const js = m.js ? assets.get(m.js) : undefined;
    const css = m.css ? assets.get(m.css) : undefined;
    return js && css && m.jsSha256 ? { js: dec.decode(js.raw), css: dec.decode(css.raw), jsSha256: m.jsSha256 } : none;
  } catch {
    // an unreadable seal is a missing seal: the exporter refuses a script it cannot hash
    return none;
  }
}
