import { expect, test } from "bun:test";
import { llmEngineOf } from "./gen.ts";
import { CliExit } from "./io.ts";

test("WP41-3 --llm は setup のプロバイダ名を生成 engine にする", () => {
  expect(llmEngineOf("claude")).toBe("claude-cli");
  expect(llmEngineOf("muse")).toBe("generic");
  expect(llmEngineOf("ollama")).toBe("generic");
  expect(llmEngineOf("lmstudio")).toBe("generic");
  expect(llmEngineOf("openai")).toBe("generic");
  expect(llmEngineOf("grok")).toBe("grok-cli");
  expect(llmEngineOf("codex")).toBe("codex-cli");
  expect(llmEngineOf("cursor")).toBe("session");
  expect(llmEngineOf("antigravity")).toBe("antigravity-cli");
});

test("WP41-3 --llm の知らない名前は usage エラー", () => {
  const err = (() => {
    try {
      llmEngineOf("nope");
      return null;
    } catch (e) {
      return e;
    }
  })();
  expect(err).toBeInstanceOf(CliExit);
  expect((err as CliExit).code).toBe(2);
});
