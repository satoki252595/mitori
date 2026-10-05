/**
 * Web build (WP-10a; ux.md §3.2, §12.6, §13). Route views are dynamic imports whose chunks get the fixed names of
 * `CHUNK_NAMES` (manifest-checked, testing RQ-UI-2); the head inline script is generated from `src/shell/head.ts`
 * + the shared cookie parser and minified (the daemon hashes it into the CSP, apps/cli/src/daemon/static.ts).
 */
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, minifySync, type Plugin } from "vite";
import { DEFAULT_KEYMAP } from "./src/contract.ts";
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

/** Ship the immutable keyboard table as data, generated from the authoritative const (no duplicate file).
 * The module awaits it before boot, so the first visible screen already has every shortcut. */
function keymapDataPlugin(): Plugin {
  let ssr = false;
  return {
    name: "mitori-keymap-data",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      ssr = !!config.build.ssr;
    },
    transform(code, id) {
      if (ssr) return;
      if (!id.replaceAll("\\", "/").endsWith("/src/shell/keys.ts")) return;
      const binding = "export const DEFAULT_DEFS: readonly ShortcutDef[] = DEFAULT_KEYMAP;";
      if (!code.includes(binding)) throw new Error("keyboard table source changed; update its data transform");
      const ref = this.emitFile({ type: "asset", name: "keymap.json", source: JSON.stringify(DEFAULT_KEYMAP) });
      return code
        .replace("DEFAULT_KEYMAP, ", "")
        .replace(
          binding,
          `export const DEFAULT_DEFS: readonly ShortcutDef[] = await fetch(import.meta.ROLLUP_FILE_URL_${ref}).then((r) => { if (!r.ok) throw new Error("keyboard table: " + r.status); return r.json(); });`,
        );
    },
  };
}

/** CSS of canonical server-rendered components. No JavaScript preloads for the enhanced app. */
function initialStylesPlugin(): Plugin {
  return {
    name: "mitori-initial-styles",
    apply: "build",
    generateBundle(_opts, bundle) {
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
        if (/\/src\/map\/(?:MapPage|FloorPlan|RoomCard|SidePanel)\.svelte|\/src\/gen\/(?:EngineCard|GenEstimateCard|GenProgress)\.svelte/.test(ids)) add(map);
        if (
          /\/src\/reader\/(?:ReaderPage|BlockHost|ContextColumn|Minimap|Welcome)\.svelte|\/src\/(?:proposals\/ProposalBlock|threads\/ServerHtml)\.svelte/.test(
            ids,
          )
        )
          add(doc);
      }
      this.emitFile({
        type: "asset",
        fileName: "initial-css.json",
        source: JSON.stringify({ map: [...new Set([...base, ...map])], doc: [...new Set([...base, ...doc])] }),
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: import.meta.dirname,
  base: "/",
  plugins: [svelte({ compilerOptions: { runes: true } }), headPlugin(), keymapDataPlugin(), initialStylesPlugin()],
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
