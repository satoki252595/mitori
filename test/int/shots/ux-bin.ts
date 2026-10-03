/**
 * UX binary smoke (finishing pass, track ux): the COMPILED binary on a scratch git copy of go-small, a fresh
 * MITORI_HOME and a temp HOME — zero tokens (no Fix / Explain is sent; nothing spawns `claude` except the local
 * `claude plugin validate`, when installed).
 *
 *   scripts/nd bun run build:bin && scripts/nd bun test/int/shots/ux-bin.ts [--out docs/progress/ux]
 *
 * Checks: `POST /jobs/targets` (a static facts row offers its code; a heading offers nothing), the doc proposals list,
 * `mitori install claude-code` / `agents-md` through the real CLI → files + `GET /integrations` freshness →
 * `claude plugin validate` of the installed marketplace and plugin, then `mitori stop`. JSON on stdout.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { API_PREFIX } from "@mitori/core";
import { buildFixture } from "@mitori/testkit";

const ROOT = resolve(import.meta.dir, "../../..");
const argv = process.argv.slice(2);
const OUT = argv.includes("--out") ? resolve(ROOT, argv[argv.indexOf("--out") + 1] as string) : null;
const BIN = join(ROOT, `dist/mitori-${process.platform}-${process.arch}`);
if (!existsSync(BIN)) {
  console.error(`${BIN} missing (bun run build:bin)`);
  process.exit(2);
}
const check = (ok: unknown, what: string): void => {
  if (!ok) throw new Error(`check failed: ${what}`);
};
const out: Record<string, unknown> = {};
const repo = await buildFixture("go-small");
const home = realpathSync(mkdtempSync(join(tmpdir(), "mitori-uxbin-home-")));
const userHome = realpathSync(mkdtempSync(join(tmpdir(), "mitori-uxbin-user-")));
const env = { ...process.env, MITORI_HOME: home, HOME: userHome };
const run = (args: string[], cwd = repo.root) => {
  const r = Bun.spawnSync([BIN, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
let exit = 0;
const daemon = Bun.spawn([BIN, repo.root, "--no-open"], { env, stdout: "pipe", stderr: "pipe" });
try {
  let err = "";
  for await (const c of daemon.stderr as ReadableStream<Uint8Array>) {
    err += new TextDecoder().decode(c);
    if (/mitori: open (\S+)/.test(err)) break;
  }
  const url = /mitori: open (\S+)/.exec(err)?.[1] ?? "";
  check(url, `the daemon printed its login URL:\n${err}`);
  const reg = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")) as { port: number; token: string };
  const ws = /\/w\/(ws_\w+)/.exec(decodeURIComponent(url))?.[1] as string;
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`http://127.0.0.1:${reg.port}${API_PREFIX}${path}`, {
      method,
      headers: { authorization: `Bearer ${reg.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  // wait for the open scan + static doc
  for (let i = 0; i < 100; i++) {
    const st = await api<{ state: string }>("GET", `/ws/${ws}`);
    if (st.state === "ready") break;
    await Bun.sleep(50);
  }
  const s4 = await api<{ blocks: { id: string; html: string }[] }>("GET", `/ws/${ws}/doc/sections/s4`);
  const env4 = s4.blocks.find((b) => b.html.includes("TSUNDOKU_API_TOKEN"));
  check(env4, "the §4 env table");
  const t0 = performance.now();
  // a whole-block anchor (the focused block, `f` without a selection): every row's code reference
  const targets = await api<{ cited: unknown[]; candidates: { label: string; symbol?: string; source: string }[] }>("POST", `/ws/${ws}/jobs/targets`, {
    anchor: { primary: "doc", doc: { block: env4?.id, selStart: 0, selEnd: 0 } },
    text: "TSUNDOKU_API_TOKEN の既定値を dev にして",
  });
  out.targetsMs = Math.round(performance.now() - t0);
  out.targets = targets.candidates.map((c) => `${c.label} ${c.symbol ?? ""} (${c.source})`);
  check(
    targets.candidates.some((c) => c.label === "config.go:19-38"),
    `config.go Load offered: ${JSON.stringify(targets)}`,
  );
  out.proposals = await api<unknown[]>("GET", `/ws/${ws}/doc/proposals?state=pending`);
  out.integrationsBefore = (await api<{ target: string; scope: string; files: { state: string }[] }[]>("GET", "/integrations")).map(
    (v) => `${v.target}/${v.scope}: ${v.files.map((f) => f.state).join(",")}`,
  );

  const cc = run(["install", "claude-code"]);
  out.installClaude = {
    code: cc.code,
    out: cc.out
      .trim()
      .split("\n")
      .map((l) => l.replace(userHome, "~")),
  };
  check(cc.code === 0, `mitori install claude-code: ${cc.err}`);
  const mp = join(userHome, ".mitori/integrations/claude-code");
  check(existsSync(join(mp, "plugins/mitori/skills/review/SKILL.md")), "the plugin skill was written");
  const am = run(["install", "agents-md"]);
  out.installAgents = {
    code: am.code,
    out: am.out
      .trim()
      .split("\n")
      .map((l) => l.replace(repo.root, "<repo>")),
  };
  check(am.code === 0, `mitori install agents-md: ${am.err}`);
  check(readFileSync(join(repo.root, "AGENTS.md"), "utf8").startsWith("<!-- BEGIN:mitori -->"), "AGENTS.md has the block");
  out.integrationsAfter = (await api<{ target: string; scope: string; files: { path: string; state: string }[] }[]>("GET", `/integrations?ws=${ws}`)).map(
    (v) => `${v.target}/${v.scope}: ${v.files.map((f) => f.state).join(",")}`,
  );
  const claude = Bun.which("claude");
  if (claude) {
    for (const dir of [mp, join(mp, "plugins/mitori")]) {
      const v = Bun.spawnSync([claude, "plugin", "validate", dir], { stdout: "pipe", stderr: "pipe" });
      const tail = `${v.stdout}${v.stderr}`.trim().split("\n").at(-1) ?? "";
      out[`validate ${dir.replace(userHome, "~")}`] = `${v.exitCode} ${tail}`;
      check(v.exitCode === 0 && !/warning/i.test(`${v.stdout}`), `claude plugin validate ${dir}: ${v.stdout}${v.stderr}`);
    }
  } else out.validate = "claude not installed — skipped";
  const stop = run(["stop"]);
  out.stop = stop.code;
} catch (e) {
  exit = 1;
  out.failure = e instanceof Error ? e.message : String(e);
  console.error("[ux-bin] FAILED", e);
} finally {
  daemon.kill();
  await daemon.exited;
  const json = `${JSON.stringify(out, null, 2)}\n`;
  await Bun.write(Bun.stdout, json);
  if (OUT) writeFileSync(join(OUT, "ux-bin.json"), json);
  rmSync(home, { recursive: true, force: true });
  rmSync(userHome, { recursive: true, force: true });
  await repo.dispose();
}
process.exit(exit);
