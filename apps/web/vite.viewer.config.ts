/**
 * Export viewer build (WP-13; ux.md §4.13, ADR-0008): `src/viewer/main.ts` → ONE classic script (`viewer.js`, IIFE, no
 * chunks, no dynamic import) and ONE stylesheet (`viewer.css`) that `createHtmlExporter` inlines into the exported
 * file. The script is sealed here: `</script` and `<!--` cannot occur in it, so the exporter embeds it byte for byte
 * (`scripts/gen-assets.ts` then records its sha256 in `viewer.json` for the file's CSP). The app's i18n catalogs are
 * not bundled whole: the transform below cuts every `apps/web/i18n/*.json` down to the keys the viewer uses
 * (`src/viewer/catalog.ts`), so ~70 KB of strings it never shows stay out of its 60 KB gz budget.
 *
 *   scripts/nd bunx vite build -c apps/web/vite.viewer.config.ts             → dist/viewer/
 *   scripts/nd bunx vite build -c apps/web/vite.viewer.config.ts --mode report   (also prints the largest modules)
 */
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import { pickShared } from "./src/viewer/catalog.ts";

/** Cut each shared catalog file to the viewer's keys (the file's JSON text in, JSON text out). */
function catalogFilter(): Plugin {
  return {
    name: "mitori-viewer-catalog",
    enforce: "pre",
    transform(code, id) {
      if (!/\/apps\/web\/i18n\/[a-z]+\.(?:ja|en)\.json$/.test(id.replaceAll("\\", "/"))) return null;
      return { code: JSON.stringify(pickShared(JSON.parse(code) as Record<string, string>)), map: null };
    },
  };
}

/** Make the script embeddable: `<\/script` and `<\!--` are the same strings / regexes to the engine and open or close nothing in HTML. */
function seal(): Plugin {
  const fix = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
  return {
    name: "mitori-viewer-seal",
    apply: "build",
    // after the minifier (it turns `<\/script` back into `</script`): the very last thing that touches the bytes
    generateBundle(_o, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type === "chunk") out.code = fix(out.code).replace(/\n+$/, "");
        else if (typeof out.source === "string" && out.fileName.endsWith(".css")) out.source = out.source.replace(/<\/(style)/gi, "<\\/$1").replace(/\n+$/, "");
      }
    },
  };
}

/** `--mode report`: the modules that make up the script, largest first (where the 60 KB gz budget goes). */
function report(): Plugin {
  return {
    name: "mitori-viewer-report",
    apply: "build",
    generateBundle(_o, bundle) {
      const rows: [string, number][] = [];
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        for (const [id, m] of Object.entries(out.modules)) rows.push([id.replace(/^.*\/(node_modules|apps|packages)\//, "$1/"), m.renderedLength]);
      }
      rows.sort((a, b) => b[1] - a[1]);
      for (const [id, n] of rows.slice(0, 40)) console.log(`${String(n).padStart(7)}  ${id}`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: import.meta.dirname,
  base: "./",
  publicDir: false,
  plugins: [catalogFilter(), svelte({ compilerOptions: { runes: true } }), seal(), ...(mode === "report" ? [report()] : [])],
  define: {
    __MITORI_VERSION__: JSON.stringify("export"),
    __MITORI_TEST__: JSON.stringify(false),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    target: "es2022",
    outDir: "../../dist/viewer",
    emptyOutDir: true,
    cssCodeSplit: false,
    reportCompressedSize: false,
    modulePreload: false,
    sourcemap: false,
    lib: { entry: `${import.meta.dirname}/src/viewer/main.ts`, formats: ["iife"], name: "MitoriViewer", fileName: () => "viewer.js", cssFileName: "viewer" },
  },
}));
