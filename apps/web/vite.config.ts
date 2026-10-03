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
          const name = chunkName(out.facadeModuleId, out.name);
          if (name === "i18n-ja") chunks.ja = `/${out.fileName}`;
          else if (name === "i18n-en") chunks.en = `/${out.fileName}`;
          else if (name === "map") chunks.map = `/${out.fileName}`;
          else if (name === "reader") chunks.reader = `/${out.fileName}`;
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

export default defineConfig(({ mode }) => ({
  root: import.meta.dirname,
  base: "/",
  plugins: [svelte({ compilerOptions: { runes: true } }), headPlugin()],
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
    rolldownOptions: {
      output: {
        // the HTML entry is only the bootstrap; runtime + shell + stores form the `entry` chunk below
        entryFileNames: "assets/boot-[hash].js",
        chunkFileNames: (c) => `assets/${chunkName(c.facadeModuleId, c.name)}-[hash].js`,
        assetFileNames: "assets/[name]-[hash][extname]",
        codeSplitting: {
          groups: [
            {
              name: "entry",
              test: (id: string) =>
                /[\\/](node_modules[\\/](svelte|esm-env|clsx)|packages[\\/](core|client)[\\/]src|apps[\\/]web[\\/]src[\\/](shell|stores|contract\.ts))[\\/.]/.test(
                  id,
                ) && !/[\\/]shell[\\/](i18n-(ja|en)|main)\.ts$/.test(id),
              priority: 10,
            },
          ],
        },
      },
    },
  },
  worker: {
    format: "es",
    rolldownOptions: { output: { entryFileNames: "assets/palette-worker-[hash].js", chunkFileNames: "assets/palette-worker-[name]-[hash].js" } },
  },
  server: { port: 5173, strictPort: false },
}));
