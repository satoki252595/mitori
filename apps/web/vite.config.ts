/**
 * Web build (WP-10a; ux.md §3.2, §12.6, §13). Route views are dynamic imports whose chunks get the fixed names of
 * `CHUNK_NAMES` (manifest-checked, testing RQ-UI-2); the head inline script is generated from `src/shell/head.ts`
 * + the shared cookie parser and minified (the daemon hashes it into the CSP, apps/cli/src/daemon/static.ts).
 */
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, minifySync, type Plugin } from "vite";
import { parseUiCookieFields } from "./src/shell/cookie.ts";
import { bootHead, type HeadChunks } from "./src/shell/head.ts";

/** Facade module → fixed chunk name. Everything shared with the entry stays in the entry chunk. */
const FACADES: [RegExp, string][] = [
  [/\/src\/map\/views\.ts$/, "map"],
  [/\/src\/reader\/views\.ts$/, "reader"],
  [/\/src\/palette\/Palette\.svelte$/, "palette"],
  [/\/src\/gen\/GenPage\.svelte$/, "gen"],
  [/\/src\/map\/side\.ts$/, "gen"],
  [/\/src\/reader\/pop\.ts$/, "reader"],
  [/\/src\/shell\/Launcher\.svelte$/, "launcher"],
  [/\/src\/shell\/HelpOverlay\.svelte$/, "help"],
  [/\/src\/settings\/SettingsPage\.svelte$/, "settings"],
  [/\/src\/shell\/i18n-ja\.ts$/, "i18n-ja"],
  [/\/src\/shell\/i18n-en\.ts$/, "i18n-en"],
  [/\/src\/reader\/diagram\.ts$/, "diagram"],
  [/\/src\/(composer|threads|jobs|proposals|trust)\/ui\.ts$/, "loop"],
  [/\/src\/review\/ui\.ts$/, "review"],
  [/\/src\/inbox\/ui\.ts$/, "inbox"],
];

function chunkName(facade: string | null, fallback: string): string {
  const id = (facade ?? "").replaceAll("\\", "/");
  // the lazy catalog groups (src/shell/i18n-ns.ts): `i18n-ja-loop`, `i18n-en-help`, …
  const lazyCat = /\/src\/shell\/(i18n-(?:ja|en)-[a-z]+)\.ts$/.exec(id);
  if (lazyCat) return lazyCat[1] as string;
  for (const [re, name] of FACADES) if (re.test(id)) return name;
  if (/@codemirror\/merge/.test(id)) return "merge";
  if (/codemirror|@codemirror|@lezer/.test(id)) return "cm6";
  return fallback;
}

function headPlugin(): Plugin {
  return {
    name: "mitori-head",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const chunks: HeadChunks = { ja: "", en: "", map: "", reader: "" };
        for (const out of Object.values(ctx.bundle ?? {})) {
          if (out.type !== "chunk") continue;
          // route chunks by their facade (a lazy sub-facade may share a chunk name, e.g. map/side.ts → gen)
          const facade = (out.facadeModuleId ?? "").replaceAll("\\", "/");
          const name = chunkName(out.facadeModuleId, out.name);
          if (name === "i18n-ja") chunks.ja = `/${out.fileName}`;
          else if (name === "i18n-en") chunks.en = `/${out.fileName}`;
          else if (/\/src\/map\/views\.ts$/.test(facade)) chunks.map = `/${out.fileName}`;
          else if (/\/src\/reader\/views\.ts$/.test(facade)) chunks.reader = `/${out.fileName}`;
        }
        const src = `(${bootHead.toString()})(document,${parseUiCookieFields.toString()},${JSON.stringify(chunks)});`;
        const code = minifySync("head.js", src, { compress: true, mangle: true })
          .code.trim()
          .replace(/<\/script/gi, "<\\/script");
        return html.replace("<script>/*mitori:head*/</script>", `<script>${code}</script>`);
      },
    },
  };
}

/** One immutable stylesheet for both canonical initial views; enhanced feature CSS stays lazy. */
function initialStylesPlugin(): Plugin {
  let initialCss = "";
  let ssr = false;
  return {
    name: "mitori-initial-styles",
    apply: "build",
    configResolved(config) {
      ssr = Boolean(config.build.ssr);
    },
    generateBundle(_opts, bundle) {
      if (ssr) return;
      const base = new Set<string>();
      const map = new Set<string>();
      const doc = new Set<string>();
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const ids = Object.keys(out.modules).join("\n").replaceAll("\\", "/");
        const css = (out as typeof out & { viteMetadata?: { importedCss: Set<string> } }).viteMetadata?.importedCss ?? [];
        const add = (target: Set<string>) => {
          for (const file of css) target.add(`/${file}`);
        };
        if (/\/src\/shell\/(?:Shell|Header|Rail|StatusBar|Rich)\.svelte|\/styles\/(?:tokens|base|prose|diagram|levels)\.css/.test(ids)) add(base);
        if (
          /\/src\/map\/(?:MapPage|FloorPlan|RoomCard|SidePanel|EngineCard)\.svelte|\/src\/gen\/(?:GenEstimateCard|GenBreakdown|GenProgress|GenDoneCard)\.svelte/.test(
            ids,
          )
        )
          add(map);
        if (
          /\/src\/reader\/(?:ReaderPage|BlockHost|ContextColumn|Minimap|Welcome)\.svelte|\/src\/(?:proposals\/ProposalBlock|threads\/ServerHtml)\.svelte/.test(
            ids,
          )
        )
          add(doc);
      }
      const files = [...new Set([...base, ...map, ...doc])];
      if (files.length)
        initialCss = this.getFileName(
          this.emitFile({
            type: "asset",
            name: "initial.css",
            source: files
              .map((file) => {
                const asset = bundle[file.slice(1)];
                if (asset?.type !== "asset") throw new Error(`missing initial stylesheet ${file}`);
                return typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
              })
              .join("\n"),
          }),
        );
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!initialCss) throw new Error("initial stylesheet was not generated");
        return html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, "").replace("</head>", `<link rel="stylesheet" href="/${initialCss}"></head>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: import.meta.dirname,
  base: "/",
  plugins: [svelte({ compilerOptions: { runes: true } }), headPlugin(), initialStylesPlugin()],
  define: {
    __MITORI_VERSION__: JSON.stringify("dev"),
    __MITORI_TEST__: JSON.stringify(mode === "test"),
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    cssCodeSplit: true,
    // Small language files remain JSON assets too; do not inline executable data URLs into the catalog loader.
    assetsInlineLimit: (path) => (path.endsWith(".json") ? false : undefined),
    rolldownOptions: {
      treeshake: { moduleSideEffects: [{ test: /node_modules\/svelte\/src\/internal\/client\/dom\/elements\/custom-element\.js$/, sideEffects: false }] },
      output: {
        // Keep the entry's static dependencies together; enhanced views remain lazy.
        codeSplitting: {
          groups: [
            { name: "initial", tags: ["$initial"], priority: 20 },
            // Shared editor/language machinery belongs to cm6; merge contains only the diff implementation.
            { name: "cm6", test: /node_modules[\\/](?:@codemirror[\\/](?!merge[\\/])|@lezer[\\/]|style-mod[\\/]|w3c-keyname[\\/])/, priority: 10 },
          ],
        },
        // the HTML entry is only the bootstrap; runtime + shell + stores form the `entry` chunk below
        entryFileNames: "assets/boot-[hash].js",
        chunkFileNames: (c) => `assets/${chunkName(c.facadeModuleId, c.name)}-[hash].js`,
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  worker: {
    format: "es",
    rolldownOptions: { output: { entryFileNames: "assets/palette-worker-[hash].js", chunkFileNames: "assets/palette-worker-[name]-[hash].js" } },
  },
  server: { port: 5173, strictPort: false },
}));
