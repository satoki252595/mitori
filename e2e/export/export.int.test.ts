// EXP-I — `mitori export --html` against the REAL daemon composition (in-process, test/int/harness): the two routes, the
// viewer bundle the daemon embeds, the CLI command writing the file, and what the file may not contain. Zero tokens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportRes, SessionId, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { runCommand } from "../../apps/cli/src/commands/index.ts";
import { testIo } from "../../apps/cli/src/commands/test/fake-daemon.ts";
import { type Int, startInt } from "../../test/int/harness.ts";
import { bringSecretsDoc, PLANTED, plantSecrets } from "./support/prepare.ts";

const ROOT = join(import.meta.dir, "../..");
const VIEWER = join(ROOT, "dist/.build/web/viewer/viewer.json");
const CLI_VERSION = (JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as { version: string }).version;

let repo: FixtureRepo;
let int: Int;
let ws: WorkspaceKey;
let out: string;

const counts = async () => (await int.json<{ counts: { blocks: number; claims: number } }>("GET", `/ws/${ws}/doc`)).counts;

beforeAll(async () => {
  // the daemon embeds the viewer bundle that scripts/gen-assets.ts builds into dist/.build (≈ 3 s when it is missing)
  if (!existsSync(VIEWER)) {
    const r = Bun.spawnSync(["bun", "scripts/gen-assets.ts"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`gen-assets failed:\n${r.stderr.toString()}`);
  }
  out = mkdtempSync(join(tmpdir(), "mitori-export-int-"));
  repo = await buildFixture("secrets");
  plantSecrets(repo.root);
  int = await startInt();
  ws = (await int.open(repo.root)).ws;
  const base = (await counts()).blocks;
  bringSecretsDoc(repo.root);
  // the doc's prose arrives after the first scan (a read before it has nothing to stamp cites against)
  for (let i = 0; i < 100 && (await counts()).blocks <= base; i++) await Bun.sleep(100);
  await Bun.sleep(600);
}, 120_000);

afterAll(async () => {
  await int?.close();
  await repo?.dispose();
  rmSync(out, { recursive: true, force: true });
});

const body = { format: "html", level: "standard", lang: "ja", includeDecisions: false, excerpts: true };

describe("EXP-I-01 POST /ws/:ws/export", () => {
  test("returns the document, its size and hash, the redactions and the excerpts; no planted secret survives", async () => {
    const res = await int.json<ExportRes>("POST", `/ws/${ws}/export`, body);
    expect(res.html.startsWith("<!doctype html>")).toBe(true);
    expect(res.bytes).toBe(new TextEncoder().encode(res.html).length);
    expect(res.sha256).toBe(new Bun.CryptoHasher("sha256").update(res.html).digest("hex"));
    expect(res.redactions).toBeGreaterThanOrEqual(3);
    expect(res.codeExcerpts.count).toBeGreaterThanOrEqual(2);
    expect(res.codeExcerpts.files).toBeGreaterThanOrEqual(1);
    for (const v of Object.values(PLANTED)) expect(res.html.includes(v), v.slice(0, 8)).toBe(false);
    expect(res.html).toContain("«redacted:secret»");
  });

  test("the file is the viewer: one CSP, two scripts, the viewer's hash in the policy, the payload parses back", async () => {
    const res = await int.json<ExportRes>("POST", `/ws/${ws}/export`, body);
    expect([...res.html.matchAll(/<script\b/g)].length).toBe(2);
    const csp = /content="([^"]+)"/.exec(res.html)?.[1] ?? "";
    const script = /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(res.html)?.[1] ?? "";
    const b64 = new Bun.CryptoHasher("sha256").update(script).digest("base64");
    expect(csp).toContain(`script-src &#39;sha256-${b64}&#39;`);
    expect(csp).toContain("default-src &#39;none&#39;");
    const json = /<script type="application\/json" id="mitori-export">([\s\S]*?)<\/script>/.exec(res.html)?.[1] ?? "";
    expect(json).not.toMatch(/[<>&]/);
    const payload = JSON.parse(json) as { format: string; level: string; meta: { redactions: number }; sections: unknown[] };
    expect(payload.format).toBe("mitori.export/1");
    expect(payload.meta.redactions).toBe(res.redactions);
    expect(payload.sections.length).toBeGreaterThan(10);
  });

  test("excerpts:false leaves the code out (and says 0)", async () => {
    const full = await int.json<ExportRes>("POST", `/ws/${ws}/export`, body);
    const bare = await int.json<ExportRes>("POST", `/ws/${ws}/export`, { ...body, excerpts: false });
    expect(bare.codeExcerpts).toEqual({ count: 0, files: 0 });
    expect(bare.bytes).toBeLessThan(full.bytes);
    expect(bare.html).not.toContain("export const AWS_ACCESS_KEY_ID");
  });

  test("the body is validated: a wrong level, language, flag or format is a 400, not a guess", async () => {
    for (const bad of [{ level: "guru" }, { lang: "fr" }, { excerpts: "yes" }, { includeDecisions: 1 }, { format: "pdf" }]) {
      const r = await int.cli("POST", `/ws/${ws}/export`, { ...body, ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("E_INVALID_INPUT");
    }
  });

  test("an unauthenticated call is refused", async () => {
    const r = await fetch(`${int.origin}/api/v1/ws/${ws}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(401);
  });

  test("a browser session may export too (the export dialog), a cross-site request may not", async () => {
    const web = await int.browser();
    const ok = await web.req("POST", `/ws/${ws}/export`, body);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as ExportRes).bytes).toBeGreaterThan(100_000);
    const evil = await fetch(`${int.origin}/api/v1/ws/${ws}/export`, {
      method: "POST",
      headers: {
        authorization: `Mitori-Session ${web.token}`,
        "sec-fetch-site": "cross-site",
        "x-mitori-client": "web/int",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    expect(evil.status).toBe(403);
    void (undefined as unknown as SessionId);
  });
});

describe("EXP-I-02 GET /ws/:ws/export/html", () => {
  test("downloads the document as an attachment in the asked level and language", async () => {
    const r = await int.cli("GET", `/ws/${ws}/export/html?level=newcomer&lang=en`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="[^"]+\.html"$/);
    const html = await r.text();
    expect(html).toContain('<html lang="en" data-level="newcomer">');
    for (const v of Object.values(PLANTED)) expect(html.includes(v)).toBe(false);
  });

  test("excerpts=0 omits the code; anything but 0|1 is a 400", async () => {
    const bare = await (await int.cli("GET", `/ws/${ws}/export/html?excerpts=0`)).text();
    const full = await (await int.cli("GET", `/ws/${ws}/export/html`)).text();
    expect(bare.length).toBeLessThan(full.length);
    expect((await int.cli("GET", `/ws/${ws}/export/html?excerpts=2`)).status).toBe(400);
    expect((await int.cli("GET", `/ws/${ws}/export/html?level=zzz`)).status).toBe(400);
  });
});

describe("EXP-I-03 mitori export --html (the real command, the real daemon)", () => {
  const run = async (argv: string[]) => {
    const io = testIo({ argv, home: int.home, cwd: repo.root, env: {} });
    io.version = CLI_VERSION; // the daemon of this process: same version ⇒ `use`, never a restart
    const code = await runCommand("export", io);
    return { code, stdout: io.stdout, stderr: io.stderr };
  };

  test("writes the file where asked, prints its real path, and reports size, hash, redactions and excerpts", async () => {
    const r = await run(["--html", "-o", join(out, "design.html")]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(join(realpathSync(out), "design.html")); // the CLI prints the real path
    expect(r.stderr).toMatch(/exported: \d+ KB · sha256 [0-9a-f]{12} · [3-9]\d* redaction\(s\) · \d+ code excerpt\(s\) from \d+ file\(s\)/);
    const html = readFileSync(join(out, "design.html"), "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    for (const v of Object.values(PLANTED)) expect(html.includes(v)).toBe(false);
  });

  test("--no-code leaves the excerpts out; --level and --lang bake the defaults in; the default name is the repo's", async () => {
    const r = await run(["--html", "--no-code", "--level", "expert", "--lang", "en", "-o", join(out, "plain.html")]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("0 code excerpt(s) from 0 file(s)");
    expect(readFileSync(join(out, "plain.html"), "utf8")).toContain('<html lang="en" data-level="expert">');
    const d = await run(["--html"]);
    expect(d.code).toBe(0);
    expect(existsSync(join(repo.root, `${d.stdout.trim().split("/").pop()}`))).toBe(true);
    expect(d.stdout.trim().endsWith(".mitori.html")).toBe(true);
    rmSync(d.stdout.trim());
  });

  test("a missing directory and a missing --html are refused before anything is written", async () => {
    const a = await run(["--html", "-o", join(out, "nope/deeper/x.html")]);
    expect(a.code).not.toBe(0);
    expect(existsSync(join(out, "nope"))).toBe(false);
    expect((await run(["-o", join(out, "y.html")])).code).toBe(2);
    expect((await run(["--html", "--level", "guru"])).code).toBe(2);
  });

  test("the file is written atomically through SafeWriter: re-running replaces it, no temp files stay", async () => {
    const target = join(out, "again.html");
    expect((await run(["--html", "-o", target])).code).toBe(0);
    const first = readFileSync(target, "utf8");
    expect((await run(["--html", "-o", target])).code).toBe(0);
    expect(readFileSync(target, "utf8").length).toBe(first.length);
    const stray = Bun.spawnSync(["sh", "-c", `ls -A '${out}' | grep -c '\\.tmp' || true`])
      .stdout.toString()
      .trim();
    expect(stray).toBe("0");
  });
});

describe("EXP-I-04 a daemon without the viewer bundle", () => {
  test("refuses with a message that names the fix instead of writing a page that cannot run", async () => {
    const bare = await startInt({ overrides: { viewerAssets: { js: "", css: "", jsSha256: "" } } });
    try {
      const { ws: w } = await bare.open(repo.root);
      const r = await bare.cli("POST", `/ws/${w}/export`, body);
      expect(r.status).toBe(500);
      const e = (await r.json()) as { error: { code: string; message: string } };
      expect(e.error.code).toBe("E_INTERNAL");
      expect(e.error.message).toContain("viewer bundle is not built");
    } finally {
      await bare.close();
    }
  }, 60_000);
});
