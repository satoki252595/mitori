// `bun run golden [--filter <pkg>[.<part>…]] [bun test args…]` — runs the golden tests (`**/test/golden/**/*.test.ts`
// and `*.golden.test.ts`). `--filter loop.bundle` keeps packages/loop (or apps/loop) files whose path contains
// "bundle". `MITORI_UPDATE_GOLDEN=1` rewrites goldens (testkit `expectGolden`). WP-12 may replace this runner.
import { listFiles, ROOT } from "./lib/repo.ts";

const argv = process.argv.slice(2);
const at = argv.indexOf("--filter");
const filter = at >= 0 ? argv.splice(at, 2)[1] : undefined;
const [pkg, ...parts] = filter ? filter.split(".") : [];
const files = listFiles("packages", "apps", "test")
  .filter((p) => /(^|\/)test\/golden\/.*\.test\.ts$|\.golden\.test\.ts$/.test(p))
  .filter((p) => !pkg || ((p.startsWith(`packages/${pkg}/`) || p.startsWith(`apps/${pkg}/`)) && parts.every((x) => p.includes(x))));
if (files.length === 0) {
  console.log(`golden: no golden tests${filter ? ` for "${filter}"` : ""}`);
  process.exit(filter ? 1 : 0);
}
const code = await Bun.spawn(["bun", "test", ...argv, ...files.map((f) => `./${f}`)], { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] }).exited;
process.exit(code);
