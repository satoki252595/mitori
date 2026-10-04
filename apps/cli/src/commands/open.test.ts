/** NC-18 / F14: the first open of a workspace prints one Japanese hint about `mitori install`, not five English warnings. */
import { describe, expect, test } from "bun:test";
import { afterOpen } from "./open.ts";

function run(integrations: unknown[], lang = "ja_JP.UTF-8") {
  const err: string[] = [];
  const io = { env: { LANG: lang }, err: (t: string) => err.push(t), out: () => {} } as never;
  const s = {
    api: {
      async call(route: string) {
        if (route === "POST /auth/nonce") return { url: "http://127.0.0.1:1/login#n" };
        if (route === "GET /integrations") return integrations;
        throw new Error(route);
      },
    },
  } as never;
  return afterOpen(io, s, "ws_aaaaaaaaaaaa" as never, false).then(() => err);
}

const missing = (target: string, n: number) => ({ target, scope: "user", files: Array.from({ length: n }, () => ({ state: "missing" })) });

describe("NC-18 the install notice after open", () => {
  test("never-installed integrations ⇒ one hint line naming them", async () => {
    const err = await run([missing("claude-code", 3), missing("codex", 2)]);
    const hints = err.filter((l) => l.includes("mitori install"));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("claude-code / codex");
    expect(err.join("")).not.toContain("integration file(s)");
  });

  test("an outdated or partly missing install is still reported per target", async () => {
    const err = await run([{ target: "claude-code", scope: "user", files: [{ state: "outdated" }, { state: "ok" }] }]);
    expect(err.some((l) => l.includes("古くなっています"))).toBe(true);
  });
});
