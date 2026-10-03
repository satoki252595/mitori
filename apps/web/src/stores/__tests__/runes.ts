/**
 * Test-only: lets `bun test` import rune modules (`*.svelte.ts`) by compiling them with `svelte/compiler`
 * `compileModule` (TypeScript stripped first). Call `installRunes()` at the top of a test file, then import the
 * store with a dynamic `await import(...)`. No DOM is needed for `$state` / `$derived` classes.
 */
import { plugin } from "bun";
import { compileModule } from "svelte/compiler";

let installed = false;

export function installRunes(): void {
  if (installed) return;
  installed = true;
  plugin({
    name: "svelte-runes-test",
    setup(build) {
      const ts = new Bun.Transpiler({ loader: "ts", target: "browser" });
      build.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
        const src = await Bun.file(path).text();
        const js = ts.transformSync(src);
        const out = compileModule(js, { filename: path, generate: "client", dev: false });
        return { contents: out.js.code, loader: "js" };
      });
    },
  });
}
