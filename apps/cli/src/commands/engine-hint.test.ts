import { describe, expect, test } from "bun:test";
import { engineUpdateHint } from "./engine-hint.ts";

describe("WP28 engineUpdateHint: one re-setup line (spec §B)", () => {
  test("Muse gone ⇒ setup muse keeps effort/model; other generics ⇒ null", () => {
    const gone = { engine: "generic" as const, problems: [{ code: "E_AGENT_NOT_INSTALLED", message: "gone" }], path: "/h/.local/bin/muse-bin-1.4.6" };
    expect(engineUpdateHint(gone, { museEffort: "high", museModel: "muse-spark-1.3-contributor" }, "ja")).toBe(
      "`mitori setup muse --effort high --model muse-spark-1.3-contributor` を実行してください".replace(/^/, "Museが自動更新されました: "),
    );
    expect(engineUpdateHint(gone, {}, "en")).toBe("Muse updated itself: run `mitori setup muse`");
    expect(engineUpdateHint({ engine: "generic", problems: [{ code: "E_AGENT_AUTH", message: "x" }] }, {}, "ja")).toBeNull();
    expect(engineUpdateHint({ engine: "generic", problems: [{ code: "E_AGENT_NOT_INSTALLED", message: "x" }], path: "/usr/bin/other" }, {}, "ja")).toBeNull();
  });

  test("Claude binary change ⇒ setup claude; other problems ⇒ null", () => {
    const changed = { engine: "claude-cli" as const, problems: [{ code: "E_ENGINE_BINARY_CHANGED", message: "changed" }] };
    expect(engineUpdateHint(changed, {}, "ja")).toContain("`mitori setup claude`");
    expect(engineUpdateHint(changed, {}, "en")).toContain("`mitori setup claude`");
    expect(engineUpdateHint({ engine: "claude-cli", problems: [{ code: "E_AGENT_AUTH", message: "x" }] }, {}, "ja")).toBeNull();
  });

  test("Codex changed ⇒ setup codex --native; unverified ⇒ version notice, not a command", () => {
    const changed = {
      engine: "codex-cli" as const,
      problems: [{ code: "E_AGENT_CAPABILITY", message: "Codex binary changed; repin after human review" }],
    };
    expect(engineUpdateHint(changed, { codexMaxUsd: 1, codexModel: "gpt-6.1-sol" }, "ja")).toContain(
      "`mitori setup codex --native --max-estimated-usd 1 --model gpt-6.1-sol`",
    );
    const unverified = {
      engine: "codex-cli" as const,
      version: "codex-cli 9.999.9",
      problems: [{ code: "E_AGENT_CAPABILITY", message: "Codex apply_patch profile requires verified version 0.160.0" }],
    };
    const ja = engineUpdateHint(unverified, {}, "ja") ?? "";
    expect(ja).toContain("0.160.0");
    expect(ja).toContain("git pull");
    expect(ja).not.toContain("setup codex");
    const en = engineUpdateHint(unverified, {}, "en") ?? "";
    expect(en).toContain("0.160.0");
    expect(engineUpdateHint({ engine: "session", problems: [] }, {}, "ja")).toBeNull();
  });
});
