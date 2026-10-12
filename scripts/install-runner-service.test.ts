import { expect, test } from "bun:test";
import { BOOTSTRAP_ATTEMPTS, BOOTSTRAP_RETRY_MS, bootstrapWithRetry, label, plistXml } from "./install-runner-service.ts";

test("bootstrap retries a few times at a short interval, then succeeds", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await bootstrapWithRetry("gui/501", "/tmp/io.plist", {
    bootstrap: async () => (++calls <= 2 ? 1 : 0),
    sleep: async (ms) => void sleeps.push(ms),
  });
  expect(calls).toBe(3);
  expect(sleeps).toEqual([BOOTSTRAP_RETRY_MS, BOOTSTRAP_RETRY_MS]);
});

test("the first success needs no wait; exhaustion reports the unregistered state and the manual command", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await bootstrapWithRetry("gui/501", "/tmp/io.plist", {
    bootstrap: async () => (++calls, 0),
    sleep: async (ms) => void sleeps.push(ms),
  });
  expect([calls, sleeps]).toEqual([1, []]);

  calls = 0;
  const err = await bootstrapWithRetry("gui/501", "/tmp/io.plist", {
    bootstrap: async () => (++calls, 1),
    sleep: async () => {},
  }).then(
    () => "resolved",
    (e) => String(e),
  );
  expect(err).toContain("gui/501");
  expect(err).toContain("/tmp/io.plist");
  expect(err).toContain("not registered");
  expect(calls).toBe(BOOTSTRAP_ATTEMPTS);
  expect(BOOTSTRAP_ATTEMPTS).toBe(5);
  expect(BOOTSTRAP_RETRY_MS).toBe(1000);
});

test("the plist still declares the interactive reference runner (content unchanged)", () => {
  const xml = plistXml("/proj", "/proj/.mitori/cache/github-runner");
  expect(xml).toContain(`<string>${label}</string>`);
  expect(xml).toContain("<key>ProcessType</key><string>Interactive</string>");
});
