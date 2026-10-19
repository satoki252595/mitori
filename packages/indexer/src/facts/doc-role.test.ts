import { describe, expect, test } from "bun:test";
import { docRole } from "./text.ts";

describe("WP30-A docRole for agent-instruction docs", () => {
  test("skills, commands and agents get their own roles", () => {
    expect(docRole(".claude/skills/scrape/SKILL.md")).toBe("skill");
    expect(docRole(".agents/skills/apply/SKILL.md")).toBe("skill");
    expect(docRole("tools/skills/x/SKILL.md")).toBe("skill");
    expect(docRole(".claude/commands/scrape.md")).toBe("command");
    expect(docRole(".claude/commands/apply.md")).toBe("command");
    expect(docRole(".claude/agents/reviewer.md")).toBe("agent");
    expect(docRole(".agents/memory.md")).toBe("agent");
  });

  test("existing roles win over the agent-dir rules", () => {
    expect(docRole("README.md")).toBe("readme");
    expect(docRole(".cursor-plugin/README.md")).toBe("readme");
    expect(docRole("AGENTS.md")).toBe("agents");
    expect(docRole("CLAUDE.md")).toBe("claude");
    expect(docRole("docs/adr/0001.md")).toBe("adr");
    expect(docRole("src/main.ts")).toBe("other");
  });
});
