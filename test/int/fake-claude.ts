/**
 * A `claude` that answers from the scenario router (no tokens, no network): `--version`, `auth status` (subscription)
 * and `--help` for detection, and stream-json turns synthesized with `@mitori/agent/testing` `synth.genLines` for
 * every engine process — so the REAL claude-cli engine, normalizer, scheduler and ledger run (INT-04).
 * Other commands (git for shadow repositories) go to the platform spawner.
 */
import type { Spawner, SpawnSpec } from "@mitori/agent";
import { type Cassette, createFakeSpawner, promptOfStdin, REQUIRED_FLAGS, synth } from "@mitori/agent/testing";
import { createSpawner } from "@mitori/platform";
import { routeGen } from "./router.ts";

/** The configured binary path (absolute; `engines.claude-cli.binary` in config.json). */
export const FAKE_CLAUDE = "/opt/fake/bin/claude";

export interface FakeClaude extends Spawner {
  /** Engine (stream-json) processes started. */
  readonly turns: SpawnSpec[];
}

/**
 * `speed` > 0 replays the per-line `dtMs` delays (screenshots of a run in progress); 0 streams as fast as possible.
 * `respond` answers a rendered prompt with a cassette instead of the gen scenario (loop jobs, INT-06); `null` ⇒ the gen router.
 */
export function fakeClaude(
  o: { dtMs?: number; chunkChars?: number; speed?: number; respond?: (prompt: string, spec: SpawnSpec) => Cassette | null } = {},
): FakeClaude {
  const real = createSpawner({ safePath: process.env.PATH ?? "/usr/bin:/bin" });
  const turns: SpawnSpec[] = [];
  const fake = createFakeSpawner({ speed: o.speed ?? 0 });
  fake.script((s) => s.argv[0] === "--version", { stdout: ["2.1.288 (Claude Code)"] });
  fake.script((s) => s.argv[0] === "auth", { stdout: [JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" })] });
  fake.script((s) => s.argv.includes("--help"), { stdout: [`Usage: claude [options]\n  -p, ${REQUIRED_FLAGS.join("\n  ")}`] });
  fake.script(
    (s) => s.argv.includes("stream-json"),
    (spec) => {
      turns.push(spec);
      const model = spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5";
      const prompt = promptOfStdin(spec.stdin);
      const c = o.respond?.(prompt, spec) ?? synth.genLines(routeGen(prompt), { model, dtMs: o.dtMs ?? 5, chunkChars: o.chunkChars ?? 40 });
      return { lines: c.lines.map((l) => (l.line === undefined ? l : { ...l, line: l.line.split("$CWD").join(spec.cwd) })) };
    },
  );
  return {
    turns,
    spawn: (spec) => (spec.command === FAKE_CLAUDE ? fake.spawn(spec) : real.spawn(spec)),
  };
}

/** `~/.mitori/config.json` that points claude-cli at the fake binary. */
export const FAKE_CLAUDE_CONFIG = { engines: { "claude-cli": { binary: FAKE_CLAUDE } } };
