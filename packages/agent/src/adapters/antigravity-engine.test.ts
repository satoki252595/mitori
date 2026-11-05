import { expect, test } from "bun:test";
import type { BinaryPin } from "@mitori/core";
import { type EngineRequest, SIGINT_GRACE_MS } from "../contract.ts";
import {
  agyFixtureLines,
  createFakeClock,
  createFakeSpawner,
  createTestBridge,
  createTestLogger,
  readAgyFixture,
  scriptAgyProbes,
  testHasher,
  testSettings,
} from "../testing.ts";
import { timersFor } from "../util/timers.ts";
import { createAntigravityEngine } from "./antigravity-engine.ts";

const r: EngineRequest = {
  ref: "j_agy",
  mode: "answer",
  cwd: "/isolated/work",
  model: "antigravity:gemini-3.8-flash",
  effort: "low",
  tools: "none",
  writeScope: [],
  system: "Working directory: /isolated/work",
  promptVer: "loop.answer@1",
  prompt: "Explain this bundle.",
  contract: "answer/1",
  keepAlive: false,
  persistSession: false,
  budget: { inTokens: 30000, outTokens: 2000, usd: 0.5, ms: 10000 },
};
/** Recorded agy turn fixtures (WP40f): the `-p=` run replays the real stream-json bytes. */
const successTurn = agyFixtureLines("success-stdin.stream.jsonl");

function setup(records: readonly string[] = successTurn, opts: { stderr?: readonly string[]; exitCode?: number; auth?: Uint8Array | null } = {}) {
  const { stderr = [], exitCode = 0, auth = new TextEncoder().encode("keychain") } = opts;
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), { stdout: [...records], stderr: [...stderr], exitCode });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  if (auth) b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", auth);
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  return { b, spawner };
}

test("WP40-3 antigravity detect reports install and login without calling an LLM", async () => {
  const { b, spawner } = setup();
  const st = await b.engines["antigravity-cli"]!.detect();
  expect(st).toMatchObject({ engine: "antigravity-cli", installed: true, auth: "subscription", path: "/opt/native/agy" });
  expect(st.version).toContain("1.4.12");
  expect(st.problems).toEqual([]);
  expect(st.capabilities).toEqual([]);
  expect(spawner.calls.every((c) => ["--version", "--help", "models", "-s"].includes(c.argv[0] as string))).toBe(true);
});

test("WP40f-1 antigravity detect is ready when --help arrives on stderr only", async () => {
  // 実物 (agy 1.4.12) は help.stdout が 0 バイト・exit 0 でヘルプを stderr に出す。stdout だけ見ていた頃は
  // E_AGENT_CAPABILITY で止まった (gen-real --engine antigravity-cli の実測)。
  expect(agyFixtureLines("help.stdout")).toEqual([]);
  expect(readAgyFixture("help.stderr")).toContain("--input-format");
  const { b } = setup();
  const st = await b.engines["antigravity-cli"]!.detect();
  expect(st.problems).toEqual([]);
  expect(st).toMatchObject({ engine: "antigravity-cli", installed: true, auth: "subscription" });
});

test("WP40-4 antigravity answer turn isolates HOME/workdir, hides the prompt, and prices terminal usage", async () => {
  const { b, spawner } = setup();
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  // the recorded stdin turn reports usage input 2160 / output 2 / thinking 0 / cache-read 0. Text is the
  // terminal result.response verbatim ("OK5\n"): the usage-carrying DONE step_update carries the last "\n"
  // text_delta with it (WP40g; dropping that row used to lose the tail).
  expect(res.text).toBe("OK5\n");
  expect(res.usage).toMatchObject({ in: 2160, out: 2, thinking: 0, cacheRead: 0 });
  // priceUsage rounds to micro-USD
  expect(res.usage.apiUsd).toBe(Math.round(2160 * 1.5 + 0 * 0.15 + 2 * 7.5) / 1_000_000);
  expect(res.usageEstimated).toBe(false);
  expect(res.auth).toBe("subscription");
  const native = spawner.calls.find((c) => c.argv.includes("-p="))!;
  expect(native.command).toBe("/opt/native/agy");
  expect(native.cwd.startsWith(`${b.home}/run/antigravity/`)).toBe(true);
  expect(native.cwd.endsWith("/work")).toBe(true);
  expect(native.argv).toEqual([
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    "gemini-3.8-flash-low",
    "--agent",
    "mitori-text",
    "--disable-slash-commands",
    "-p=",
  ]);
  // the prompt travels on stdin (one stream-json user line), never in ps-visible argv
  expect(native.argv.join(" ")).not.toContain("Explain this bundle.");
  expect(native.stdin).toContain("Explain this bundle.");
  expect(native.stdin.split("\n")[0]).toContain('"event":"user"');
  expect(native.env.HOME).toStartWith(`${b.home}/run/antigravity/`);
  expect(native.env.HOME).not.toBe("/home/u");
  // the agent file carries the tools-less agent next to the isolated HOME
  const home = native.env.HOME as string;
  expect(home.startsWith(`${b.home}/run/antigravity/`)).toBe(true);
  const work = native.cwd as string;
  expect(work).toBe(`${home.replace(/\/home$/, "/work")}`);
  // the agent file was written with the tools-less agent, then removed with the isolation root
  expect(b.fs.writes.some((w) => w.path === `${work}/.agents/agents/mitori-text.md` && w.kind === "home")).toBe(true);
  // temporary isolation roots are removed afterwards
  expect([...b.fs.files.keys()].filter((p) => p.includes("/run/antigravity/"))).toEqual([]);
});

test("WP40g-2 antigravity keeps the body chunk riding on the usage-carrying DONE row", async () => {
  // success-stdin の変形: ACTIVE 行の "OK5" を "OK" に短くし、usage 付き DONE 行の "\n" を "5\n" に延ばした
  // （response "OK5\n" は不変）。旧 fold は DONE 行の delta を捨てるので本文が "OK" に欠ける。
  const tailOnDoneRow = successTurn.map((l) => {
    const o = JSON.parse(l) as { event?: string; step_update?: Record<string, unknown> };
    if (o.event === "step_update" && o.step_update?.step_type === "agent_response") {
      if (o.step_update.usage !== undefined) o.step_update.text_delta = "5\n";
      else o.step_update.text_delta = "OK";
    }
    return JSON.stringify(o);
  });
  const { b } = setup(tailOnDoneRow);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("OK5\n");
  expect(res.usageEstimated).toBe(false);
});

test("WP40g-2 antigravity fails when the terminal response and the streamed text largely disagree", async () => {
  // success-stdin の変形: response だけ空にした（deltas は "OK5\n" のまま）。どちらが正しいか分からないので protocol エラー。
  const emptyResponse = successTurn.map((l) => {
    const o = JSON.parse(l) as { event?: string; result?: Record<string, unknown> };
    if (o.event === "result" && o.result) o.result.response = "";
    return JSON.stringify(o);
  });
  const { b } = setup(emptyResponse);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
});

test("WP40-5 antigravity refuses agent/patch modes, tool requests and inexact models before spawning", async () => {
  const { b, spawner } = setup();
  const calls = () => spawner.calls.filter((c) => c.argv.includes("-p=")).length;
  for (const override of [
    { mode: "agent", tools: "read_edit", cwd: "/w" },
    { mode: "patch" },
    { tools: "read_edit" },
    { model: "sonnet" },
  ] as Partial<EngineRequest>[]) {
    const res = await b.engines["antigravity-cli"]!.run({ ...r, ...override }, new AbortController().signal).result;
    expect(["E_UNSUPPORTED", "E_INVALID_INPUT"]).toContain(res.error?.code ?? "none");
  }
  expect(calls()).toBe(0);
});

test("WP40-6 antigravity fails a turn that ran a tool, without using its text", async () => {
  // 実物の tool-step 記録をそのまま再生 (tool run_command が auto-denied され、stderr に jetski の説明が出る)。
  const { b } = setup(agyFixtureLines("tool-step.stream.jsonl"), { stderr: agyFixtureLines("tool-step.stderr") });
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.message).toContain("run_command");
  expect(res.text).toBe("");
  // usage は tool step の前に報告済み (7244/399+362/0) なので残る。報告が無い turn だけ zero になる (engine の設計どおり)。
  expect(res.usage).toMatchObject({ in: 7244, out: 761, thinking: 362, cacheRead: 0 });
  expect(res.usage.apiUsd).toBe(Math.round(7244 * 1.5 + 0 * 0.15 + 761 * 7.5) / 1_000_000);
});

test("WP40-6 antigravity denied_actions fail the turn", async () => {
  // fixture に denied(文字列配列)形が無いので、success-stdin の result に denied_actions だけ足した最小変形。
  const denied = successTurn.map((l) => {
    const o = JSON.parse(l) as { event?: string; result?: Record<string, unknown> };
    if (o.event === "result" && o.result) o.result.denied_actions = ["run_command"];
    return JSON.stringify(o);
  });
  const { b } = setup(denied);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
});

test("WP40-7 antigravity stops at once on the stderr login URL and guides to mitori auth antigravity", async () => {
  // 実物の auth-missing 記録をそのまま再生 (stderr の Google OAuth URL で即時停止する)。
  // turn の exit は未採取のため、model 到達前の失敗形を保つ exit 1 としている。
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), {
      stdout: agyFixtureLines("auth-missing.stream.jsonl"),
      stderr: agyFixtureLines("auth-missing.stderr"),
      exitCode: 1,
    });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const child = () => spawner.children.find((c) => c.spec.argv.includes("-p="));
  const run = b.engines["antigravity-cli"]!.run(r, new AbortController().signal);
  const res = await run.result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_AUTH");
  expect(res.error?.message).toContain("mitori auth antigravity");
  // the child was stopped at once instead of waiting out the 60 s login wait
  expect(child()?.signals).toContain("SIGINT");
});

test("WP40-7 antigravity maps authentication failed or timed out to E_AGENT_AUTH", async () => {
  // 実物の auth-missing turn (stdout の ERROR 行) をそのまま再生。stderr が無くても E_AGENT_AUTH になる。
  const { b } = setup(agyFixtureLines("auth-missing.stream.jsonl"));
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_AUTH");
  expect(res.error?.message).toContain("mitori auth antigravity");
});

test("WP40-8 antigravity cancels a hanging turn with SIGINT then SIGKILL, in its own process group", async () => {
  const clock = createFakeClock();
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const engine = b.engines["antigravity-cli"]!;
  const ctl = new AbortController();
  const run = engine.run(r, ctl.signal);
  await Bun.sleep(5);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="))!;
  // the whole agy subtree dies with the child: grandchildren get the same signals
  expect(child.spec.processGroup).toBe(true);
  ctl.abort();
  await Bun.sleep(1);
  expect(child.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  const res = await run.result;
  expect(res.stop).toBe("cancelled");
  expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
  // the isolation is removed and nothing is left behind for the daemon stop to reap
  expect([...b.fs.files.keys()].filter((p) => p.includes("/run/antigravity/"))).toEqual([]);
  await engine.closeAll!();
  expect(spawner.children.every((c) => c.signals.includes("SIGKILL") || !c.spec.argv.includes("-p="))).toBe(true);
});

test("WP40-8 antigravity closeAll kills a live child on daemon stop without a run cancel", async () => {
  const clock = createFakeClock();
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const engine = b.engines["antigravity-cli"]!;
  const run = engine.run(r, new AbortController().signal);
  await Bun.sleep(5);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="))!;
  // daemon stop (scheduler drain): closeAll SIGINTs the live child, SIGKILLs after the grace
  const closing = engine.closeAll!();
  await Bun.sleep(1);
  expect(child.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  await closing;
  expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
  const res = await run.result;
  expect(res.stop).toBe("error");
  await engine.closeAll!();
});

test("WP40-8 antigravity timeout names the seconds and records zero usage without a usage event", async () => {
  const clock = createFakeClock();
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const run = b.engines["antigravity-cli"]!.run(r, new AbortController().signal);
  await Bun.sleep(5);
  clock.advance(r.budget.ms + 1);
  await Bun.sleep(1);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="));
  expect(child?.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  const res = await run.result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_TIMEOUT");
  expect(res.error?.message).toBe("agy が時間内（10 秒）に終わりませんでした");
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP40-9 antigravity without a usage event byte-estimates; without prices it reserves the cap", async () => {
  // fixture に usage 無しの成功形が無いので、success-stdin から usage だけ落とした最小変形。
  const noUsage = successTurn.map((l) => {
    const o = JSON.parse(l) as { step_update?: Record<string, unknown>; result?: Record<string, unknown> };
    if (o.step_update) delete o.step_update.usage;
    if (o.result) delete o.result.usage;
    return JSON.stringify(o);
  });
  const { b } = setup(noUsage);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("OK5\n");
  expect(res.usageEstimated).toBe(true);
  expect(res.usage.out).toBe(new TextEncoder().encode("OK5\n").length);
  expect(res.usage.apiUsd).toBeGreaterThan(0);
});

test("WP40-C antigravity without login reports auth none and never runs", async () => {
  // 未ログイン時の models 出力は未採取のため、--version/--help だけ fixture 再生し models だけ手書き。
  const unauth = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: agyFixtureLines("version.stdout"), stderr: agyFixtureLines("version.stderr") })
    .script((s) => s.argv[0] === "models", { stdout: ["Please sign in with Google to use Antigravity."], exitCode: 1 })
    .script((s) => s.argv[0] === "--help", { stdout: agyFixtureLines("help.stdout"), stderr: agyFixtureLines("help.stderr") });
  const b = createTestBridge({
    spawner: unauth,
    env: { HOME: "/home/u", PATH: "/usr/bin" },
    settings: (s) => {
      s.engines["antigravity-cli"] = { enabled: true, binary: "/opt/native/agy", model: "gemini-3.8-flash" };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  const st = await b.engines["antigravity-cli"]!.detect();
  expect(st).toMatchObject({ installed: true, auth: "none" });
  expect(st.problems.map((p) => p.code)).toEqual(["E_AGENT_AUTH"]);
  expect(st.problems[0]?.message).toContain("mitori auth antigravity");
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.error?.code).toBe("E_AGENT_AUTH");
  expect(unauth.calls.every((c) => ["--version", "--help", "models"].includes(c.argv[0] as string))).toBe(true);
  expect(unauth.calls.some((c) => c.argv.includes("-p="))).toBe(false);
});

test("WP40-C antigravity records zero usage when nothing reached the model", async () => {
  // stdout 無し・exit 非 0 の失敗形は未採取のため、turn だけ手書き (stderr は tool-step 記録の jetski 行に準じた文面)。
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), { stdout: [], stderr: ["jetski: no output produced — the turn was stopped"], exitCode: 1 });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP40-b3 antigravity follows a moved pin only through --version and the --help capability gate", async () => {
  const pin: BinaryPin = {
    path: "/opt/link/agy",
    realpath: "/opt/native/agy-old",
    sha256: testHasher.sha256("old"),
    version: "1.4.11",
    pinnedAt: "2026-11-01T00:00:00Z",
    by: "user",
  };
  const settings = testSettings({
    engines: {
      "antigravity-cli": {
        enabled: true,
        binary: "/opt/link/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      },
    },
  });
  settings.pins.agy = pin;
  // follow の --help 能力ゲートも実物どおり stderr 再生 (2 本目の到達不能な --help 手書きは落とした)。
  const spawner = scriptAgyProbes(createFakeSpawner()).script((s) => s.argv[0] === "-s", { stdout: [] });
  const clock = createFakeClock();
  const engine = createAntigravityEngine({
    spawner,
    settings: () => settings,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin" },
    safePath: "/usr/bin:/bin",
    clock,
    timers: timersFor(clock),
    hasher: testHasher,
    fs: {
      realpath: (p) => (p === "/opt/link/agy" ? "/opt/native/agy-new" : p),
      stat: (p) => (p.startsWith("/opt/native/") ? { isFile: true, isDir: false, isSymlink: false, size: 3, mtimeNs: 0n, ino: 9n } : null),
      read: async (p) => new TextEncoder().encode(p.endsWith("agy-new") ? "new" : "old"),
      readHead: async () => new Uint8Array(),
      readdir: () => [],
    },
    prepareIsolation: async () => ({ home: "/isolated/agy-home", work: "/isolated/agy-work", auth: "subscription" as const, cleanup: async () => {} }),
    pin: async () => {},
    follow: {
      workspaceRoots: () => [],
      ownership: () => ({ uid: 1000, mode: 0o755 }),
      fileId: () => ({ dev: 0, ino: 9, size: 3, mtimeMs: 1 }),
      sha256File: async () => testHasher.sha256("new"),
      euid: 1000,
      platform: "linux",
    },
    log: createTestLogger(),
  });
  const st = await engine.detect();
  expect(st.problems).toEqual([]);
  expect(st.installed).toBe(true);
  expect(st.pin?.realpath).toBe("/opt/native/agy-new");
});

test("WP40-b3 antigravity keeps the human-review error when the follow candidate misses a spawned flag", async () => {
  const pin: BinaryPin = {
    path: "/opt/link/agy",
    realpath: "/opt/native/agy-old",
    sha256: testHasher.sha256("old"),
    version: "1.4.11",
    pinnedAt: "2026-11-01T00:00:00Z",
    by: "user",
  };
  const settings = testSettings({
    engines: {
      "antigravity-cli": {
        enabled: true,
        binary: "/opt/link/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      },
    },
  });
  settings.pins.agy = pin;
  // fixture の help.stderr から mitori が渡す flag 行だけ抜いた最小変形 (version は fixture の 1.4.12 のまま)。
  const noFlagHelp = readAgyFixture("help.stderr")
    .split("\n")
    .filter((l) => !/--input-format|--output-format|--model|--agent|--disable-slash-commands|--print|^\s*-p[\s,]/.test(l));
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: agyFixtureLines("version.stdout"), stderr: agyFixtureLines("version.stderr") })
    .script((s) => s.argv[0] === "--help", { stdout: [], stderr: noFlagHelp });
  const clock = createFakeClock();
  const engine = createAntigravityEngine({
    spawner,
    settings: () => settings,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin" },
    safePath: "/usr/bin:/bin",
    clock,
    timers: timersFor(clock),
    hasher: testHasher,
    fs: {
      realpath: (p) => (p === "/opt/link/agy" ? "/opt/native/agy-new" : p),
      stat: (p) => (p.startsWith("/opt/native/") ? { isFile: true, isDir: false, isSymlink: false, size: 3, mtimeNs: 0n, ino: 9n } : null),
      read: async (p) => new TextEncoder().encode(p.endsWith("agy-new") ? "new" : "old"),
      readHead: async () => new Uint8Array(),
      readdir: () => [],
    },
    prepareIsolation: async () => ({ home: "/isolated/agy-home", work: "/isolated/agy-work", auth: "subscription" as const, cleanup: async () => {} }),
    follow: {
      workspaceRoots: () => [],
      ownership: () => ({ uid: 1000, mode: 0o755 }),
      fileId: () => ({ dev: 0, ino: 9, size: 3, mtimeMs: 1 }),
      sha256File: async () => testHasher.sha256("new"),
      euid: 1000,
      platform: "linux",
    },
    log: createTestLogger(),
  });
  const first = await engine.detect();
  expect(first.problems.map((p) => p.code)).toEqual(["E_AGENT_CAPABILITY"]);
  expect(first.problems[0]?.message).toContain("repin");
});

test("WP40b-1 antigravity unknown agent ERROR fails with guidance naming the agent", async () => {
  // fixture に unknown-agent 形が無いので、auth-missing の error 値だけ置き換えた最小変形 (文字列置換だと JSON が壊れる)。
  const unknownAgent = agyFixtureLines("auth-missing.stream.jsonl").map((l) => {
    const o = JSON.parse(l) as { result?: Record<string, unknown> };
    if (o.result) o.result.error = 'error: unknown agent "mitori-text" (no custom agents are available)';
    return JSON.stringify(o);
  });
  const { b } = setup(unknownAgent);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.message).toContain("unknown agent");
  // the raw agy error alone is not enough: the message guides back to the setup
  expect(res.error?.message).toContain("mitori-text");
  expect(res.error?.message).toContain("setup");
});

test("WP40h-1 antigravity ends the turn at result and stops a lingering child as success", async () => {
  // 実物 (agy 1.5.0): result の 24〜33 秒後にプロセスが 2 分以上残る。result 到来で turn 終了とし、
  // stdin を閉じて 2 秒待ち、終わらなければ SIGTERM（さらに 8 秒で SIGKILL）する。SUCCESS は成功扱い。
  const clock = createFakeClock();
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), { stdout: [...successTurn], hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const engine = b.engines["antigravity-cli"]!;
  const run = engine.run(r, new AbortController().signal);
  await Bun.sleep(10);
  clock.advance(2000);
  await Bun.sleep(5);
  const res = await run.result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("OK5\n");
  expect(res.usageEstimated).toBe(false);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="))!;
  expect(child.signals).toEqual(["SIGTERM"]);
  expect(await child.exited).toBe(143);
  // 子は回収済みで daemon stop は何もしない
  await engine.closeAll!();
  expect(child.signals).toEqual(["SIGTERM"]);
  expect(b.log.lines.some((l) => l.lvl === "debug" && l.msg.includes("antigravity"))).toBe(true);
});

test("WP40h-2 antigravity SIGTERMs a lingering child then SIGKILLs when SIGTERM is ignored", async () => {
  const clock = createFakeClock();
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), { stdout: [...successTurn], hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const engine = b.engines["antigravity-cli"]!;
  const run = engine.run(r, new AbortController().signal);
  await Bun.sleep(10);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="))!;
  // 初回の SIGTERM を無視する fake (2 回目の SIGKILL で終わる)
  const origKill = child.kill.bind(child);
  let termIgnored = false;
  (child as { kill: (s: "SIGINT" | "SIGTERM" | "SIGKILL") => void }).kill = (s) => {
    if (s === "SIGTERM" && !termIgnored) {
      termIgnored = true;
      (child.signals as string[]).push(s);
      return;
    }
    return origKill(s);
  };
  clock.advance(2000);
  await Bun.sleep(5);
  clock.advance(8000);
  await Bun.sleep(5);
  const res = await run.result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("OK5\n");
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(await child.exited).toBe(137);
});

test("WP40h-3 antigravity fails a SUCCESS result preceded by error_message without using its text", async () => {
  // fixture に error_message 形が無いので、success-stdin の result 直前に実物形の変種を挿した最小変形。
  const withErrorMessage = (() => {
    const out: string[] = [];
    for (const l of successTurn) {
      const o = JSON.parse(l) as { event?: string };
      if (o.event === "result")
        out.push(
          JSON.stringify({
            event: "step_update",
            step_update: {
              conversation_id: "af38552f-d88b-4606-85f2-769b22f46b89",
              step_index: 2,
              state: "DONE",
              step_type: "error_message",
              duration_seconds: 0,
            },
          }),
        );
      out.push(l);
    }
    return out;
  })();
  const { b } = setup(withErrorMessage);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.retryable).toBe(true);
  expect(res.text).toBe("");
});

test("WP40b-1 antigravity unknown agent on stderr (no result) fails with the same guidance", async () => {
  // result 無し・stderr のみ形は未採取のため turn だけ手書き (probes は fixture 再生)。
  const spawner = scriptAgyProbes(createFakeSpawner())
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv.includes("-p="), {
      stdout: [],
      stderr: ['error: unknown agent "mitori-text" (no custom agents are available)'],
      exitCode: 1,
    });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.message).toContain("unknown agent");
  expect(res.error?.message).toContain("setup");
});
