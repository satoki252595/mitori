// WP12: two gen-assets builds sharing one out dir must both succeed, even when
// the second starts mid-build (the incident: `ENOENT ... initial-<hash>.css`).
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.ts";

test("two offset builds into the same out dir both succeed with a complete tree", async () => {
  const out = `dist/.wp12-conc-${process.pid}`;
  const abs = join(ROOT, out);
  rmSync(abs, { recursive: true, force: true });
  try {
    const run = () =>
      Bun.spawn([process.execPath, join(ROOT, "scripts/gen-assets.ts"), "--out", out], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
    const a = run();
    const outA = new Response(a.stdout).text();
    const errA = new Response(a.stderr).text();
    await Bun.sleep(1500); // B starts while A is still building the web dist
    const b = run();
    const outB = new Response(b.stdout).text();
    const errB = new Response(b.stderr).text();
    const [ca, cb] = await Promise.all([a.exited, b.exited]);
    const [oa, ea, ob, eb] = await Promise.all([outA, errA, outB, errB]);
    if (ca !== 0 || cb !== 0) throw new Error(`gen-assets failed under offset concurrency (a=${ca}, b=${cb}):\n--- a ---\n${oa}${ea}\n--- b ---\n${ob}${eb}`);
    // the published tree is complete: every file the manifest names exists
    const web = JSON.parse(readFileSync(join(abs, "web.json"), "utf8")) as Record<string, { raw: string; br?: string; gz?: string }>;
    expect(web["/index.html"]).toBeTruthy();
    for (const e of Object.values(web)) for (const p of [e.raw, e.br, e.gz]) if (p !== undefined) expect(existsSync(join(ROOT, p))).toBe(true);
    expect(existsSync(join(abs, "initial/initial.js"))).toBe(true);
    expect(existsSync(join(abs, "assets.gen.ts"))).toBe(true);
    // no staging leftovers from either builder
    const litter = readdirSync(join(ROOT, "dist")).filter((n) => n.startsWith(`.wp12-conc-${process.pid}.`));
    expect(litter).toEqual([]);
  } finally {
    rmSync(abs, { recursive: true, force: true });
    for (const n of readdirSync(join(ROOT, "dist")))
      if (n.startsWith(`.wp12-conc-${process.pid}.`)) rmSync(join(ROOT, "dist", n), { recursive: true, force: true });
  }
}, 90_000);
