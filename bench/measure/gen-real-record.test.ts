// The recorder of bench/measure/gen-real.ts over a scripted claude (0 tokens): an engine process is saved with its argv,
// CLAUDE_CODE_* env values (other env values are not kept), stdin, later writes and stdout lines; other spawns pass through.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSpawner, synth } from "@mitori/agent/testing";
import { cassetteScript } from "../../packages/agent/src/fakes/cassette.ts";
import { type RecordedProcess, recordingSpawner } from "./gen-real-record.ts";

const dir = mkdtempSync(join(tmpdir(), "mitori-rec-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("BENCH-GENREAL-01 recordingSpawner saves an engine process after its result; probes are not recorded", async () => {
  const inner = createFakeSpawner({ speed: 0 })
    .script((s) => s.argv[0] === "--version", { stdout: ["2.1.288 (Claude Code)"] })
    .script((s) => s.argv.includes("stream-json"), cassetteScript(synth.text("{}", { usage: { input_tokens: 10, output_tokens: 2 } })));
  const sp = recordingSpawner(dir, inner);
  const base = {
    env: { PATH: "/usr/bin", CLAUDE_CODE_PROMPT_CACHE_TTL: "5m", HOME: "/secret/home" },
    cwd: "/tmp",
    keepStdinOpen: false,
    timeoutMs: 5000,
    processGroup: true,
  };
  const probe = sp.spawn({ ...base, command: "/bin/claude", argv: ["--version"], stdin: "" });
  probe.closeStdin();
  for await (const _ of probe.stdout) {
    // drain
  }
  const c = sp.spawn({ ...base, keepStdinOpen: true, command: "/bin/claude", argv: ["-p", "--output-format", "stream-json"], stdin: '{"type":"user"}\n' });
  c.write("retry\n");
  c.closeStdin();
  const lines: string[] = [];
  for await (const l of c.stdout) lines.push(l);
  await c.exited;
  await Bun.sleep(10);
  expect(lines.some((l) => l.startsWith('{"type":"result"'))).toBe(true);
  expect(existsSync(join(dir, "002.json"))).toBe(false);
  const rec = JSON.parse(readFileSync(join(dir, "001.json"), "utf8")) as RecordedProcess;
  expect(rec.argv).toContain("stream-json");
  expect(rec.env).toEqual({ CLAUDE_CODE_PROMPT_CACHE_TTL: "5m" });
  expect(rec.envKeys).toEqual(["CLAUDE_CODE_PROMPT_CACHE_TTL", "HOME", "PATH"]);
  expect(rec.stdin).toBe('{"type":"user"}\n');
  expect(rec.writes).toEqual(["retry\n"]);
  expect(rec.out.map(([, l]) => l)).toEqual(lines);
  expect(rec.exit).toBe(0);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  expect(statSync(join(dir, "001.json")).mode & 0o777).toBe(0o600);
});
