import { describe, expect, test } from "bun:test";
import type { EngineStatus, GlobalSettings } from "@mitori/core";
import { defaultLlm, llmOptions } from "./llm.ts";

const settings = (over: Record<string, unknown> = {}): GlobalSettings =>
  ({
    defaultEngine: "claude-cli",
    engines: {
      "claude-cli": { enabled: true },
      session: { enabled: true },
      "anthropic-api": { enabled: false },
      "codex-cli": { enabled: true },
      "grok-cli": { enabled: true },
      "antigravity-cli": { enabled: false },
      generic: { enabled: false },
    },
    ...over,
  }) as unknown as GlobalSettings;

const ok = (engine: EngineStatus["engine"]): EngineStatus =>
  ({ engine, installed: true, auth: "subscription", capabilities: [], billing: "unknown", problems: [], checkedAt: "" }) as unknown as EngineStatus;

describe("WP41-5 composer LLM select", () => {
  test("候補は有効な engine だけ、grok は patch・agent で選べない", () => {
    const opts = llmOptions(settings(), null, "patch");
    expect(opts.map((o) => o.engine)).toEqual(["claude-cli", "session", "codex-cli", "grok-cli"]);
    expect(opts.find((o) => o.engine === "grok-cli")).toMatchObject({ disabled: true, reason: "textOnly" });
    expect(opts.find((o) => o.engine === "session")).toMatchObject({ disabled: true, reason: "sessionOnly" });
    expect(opts.find((o) => o.engine === "codex-cli")).toMatchObject({ disabled: false, reason: null });
  });

  test("answer なら grok も選べる", () => {
    const opts = llmOptions(settings(), null, "answer");
    expect(opts.find((o) => o.engine === "grok-cli")).toMatchObject({ disabled: false, reason: null });
  });

  test("未ログインの engine は理由付きで選べない", () => {
    const statuses = [ok("claude-cli"), { ...ok("codex-cli"), installed: false }];
    const opts = llmOptions(settings(), statuses, "answer");
    expect(opts.find((o) => o.engine === "codex-cli")).toMatchObject({ disabled: true, reason: "notInstalled" });
    expect(opts.find((o) => o.engine === "claude-cli")).toMatchObject({ disabled: false, reason: null });
  });

  test("初期値は既定のLLM、使えないときは先頭の使えるもの", () => {
    expect(defaultLlm(settings(), null, null)).toBe("claude-cli");
    expect(defaultLlm(settings({ defaultEngine: "session" }), null, "patch")).toBe("claude-cli");
    expect(defaultLlm(settings({ defaultEngine: "grok-cli" }), null, "agent")).toBe("claude-cli");
  });
});
