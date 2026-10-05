import { expect, test } from "bun:test";
import type { GlobalSettings } from "@mitori/core";
import { cassetteScript } from "../fakes/cassette.ts";
import { createFakeSpawner, createTestBridge, synth } from "../testing.ts";
import { REQUIRED_FLAGS } from "./detect.ts";
import type { ClaudeCliEngine } from "./engine.ts";

const OLD = "/opt/test/bin/claude";
const NEW = "/opt/new/bin/claude";
const spawner = () =>
  createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["2.1.288 (Claude Code)"] })
    .script((s) => s.argv[0] === "auth", { stdout: ['{"loggedIn":true,"authMethod":"claude.ai"}'] })
    .script((s) => s.argv[0] === "--help", { stdout: [REQUIRED_FLAGS.join(" ")] });

test("an explicit Claude path with the previous pin fails closed before any probe or model call", async () => {
  const sp = spawner();
  const b = createTestBridge({
    spawner: sp,
    settings: (s) => {
      s.engines["claude-cli"].binary = NEW;
    },
  });
  const status = await b.engines["claude-cli"]?.detect();
  expect(status?.installed).toBe(false);
  expect(status?.problems[0]?.code).toBe("E_ENGINE_BINARY_CHANGED");
  expect(sp.calls).toHaveLength(0);
  expect(b.ledger.rows).toHaveLength(0);
});

test("a new matching pin invalidates cached status and launches the selected Claude path", async () => {
  const sp = spawner().script((s) => s.argv.includes("-p"), cassetteScript(synth.text("ok")));
  let settings: GlobalSettings | undefined;
  const b = createTestBridge({
    spawner: sp,
    settings: (s) => {
      settings = s;
    },
  });
  const engine = b.engines["claude-cli"] as ClaudeCliEngine;
  expect((await engine.detect()).path).toBe(OLD);
  if (!settings?.pins.claude) throw new Error("missing test settings");
  settings.engines["claude-cli"].binary = NEW;
  settings.pins.claude = { ...settings.pins.claude, path: NEW, realpath: NEW, sha256: "1".repeat(64), by: "user" };
  expect(engine.lastStatus()).toBeNull();
  expect((await engine.detect()).path).toBe(NEW);
  expect(sp.calls.slice(3).map((s) => s.command)).toEqual([NEW, NEW, NEW]);
  const cwd = "/home/u/.mitori/run/empty";
  const run = engine.run(
    {
      ref: "j_pin",
      mode: "answer",
      cwd,
      model: "claude-sonnet-5-5",
      effort: "low",
      tools: "none",
      writeScope: [],
      system: `Use the bundle.\nWorking directory: ${cwd}`,
      prompt: "Explain.",
      promptVer: "answer@1",
      contract: "answer/1",
      keepAlive: false,
      persistSession: false,
      budget: { inTokens: 1000, outTokens: 1500, usd: 0.1, ms: 120_000 },
    },
    new AbortController().signal,
  );
  expect((await run.result).stop).toBe("end");
  expect(sp.calls.at(-1)?.command).toBe(NEW);
});

test("a pin update during detection cannot return the previous executable's status", async () => {
  let settings: GlobalSettings | undefined;
  const sp = createFakeSpawner()
    .script(
      (s) => s.argv[0] === "--version",
      (s) => {
        if (s.command === OLD && settings?.pins.claude) {
          settings.engines["claude-cli"].binary = NEW;
          settings.pins.claude = { ...settings.pins.claude, path: NEW, realpath: NEW, sha256: "1".repeat(64), by: "user" };
        }
        return { stdout: ["2.1.288 (Claude Code)"] };
      },
    )
    .script((s) => s.argv[0] === "auth", { stdout: ['{"loggedIn":true,"authMethod":"claude.ai"}'] })
    .script((s) => s.argv[0] === "--help", { stdout: [REQUIRED_FLAGS.join(" ")] });
  const b = createTestBridge({
    spawner: sp,
    settings: (s) => {
      settings = s;
    },
  });
  expect((await b.engines["claude-cli"]?.detect())?.path).toBe(NEW);
  expect(sp.calls.map((s) => s.command)).toEqual([OLD, OLD, OLD, NEW, NEW, NEW]);
});
