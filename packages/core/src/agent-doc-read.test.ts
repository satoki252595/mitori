import { describe, expect, test } from "bun:test";
import picomatch from "picomatch";
import { AGENT_DOC_READ_GLOBS, DEFAULT_DENY_GLOBS, isAgentDocReadable } from "./domain.ts";

// The read-side exception (write deny is unchanged): text docs under the four agent-instruction directories.
const readMatcher = picomatch([...AGENT_DOC_READ_GLOBS], { dot: true });
const denyMatcher = picomatch([...DEFAULT_DENY_GLOBS], { dot: true });

describe("WP30-A isAgentDocReadable", () => {
  test("text docs under .claude / .codex / .agents / .cursor are readable", () => {
    for (const p of [
      ".claude/skills/scrape/SKILL.md",
      ".claude/commands/scrape.md",
      ".claude/agents/reviewer.md",
      ".codex/skills/x/SKILL.md",
      ".agents/skills/apply/SKILL.md",
      ".cursor/rules/sync.mdc",
      ".claude/notes.txt",
      ".agents/guide.markdown",
      ".claude/skills/X/SKILL.MD",
    ])
      expect(isAgentDocReadable(p)).toBe(true);
  });

  test("non-text files, other dirs and bare names are not readable", () => {
    for (const p of [
      ".claude/settings.json",
      ".claude/hooks/notify.sh",
      ".claude/mcp.json",
      ".agents/config.toml",
      ".codex/auth.json",
      ".cursor/hooks/x.py",
      "README.md",
      ".claude.md",
      ".claude/skills/x/SKILL.md.bak",
      "docs/.claude-notes.md",
    ])
      expect(isAgentDocReadable(p)).toBe(false);
  });

  test("AGENT_DOC_READ_GLOBS agrees with isAgentDocReadable (picomatch dot:true)", () => {
    const paths = [
      ".claude/skills/scrape/SKILL.md",
      ".claude/commands/scrape.md",
      ".codex/a/b/c.mdc",
      ".agents/guide.markdown",
      ".cursor/notes.txt",
      ".claude/settings.json",
      ".agents/run.sh",
      "README.md",
    ];
    for (const p of paths) expect(readMatcher(p)).toBe(isAgentDocReadable(p));
  });

  test("the write side is unchanged: DEFAULT_DENY_GLOBS still matches the readable docs", () => {
    for (const p of [".claude/skills/scrape/SKILL.md", ".agents/skills/apply/SKILL.md", ".codex/commands.md", ".cursor/notes.txt"])
      expect(denyMatcher(p)).toBe(true);
  });
});
