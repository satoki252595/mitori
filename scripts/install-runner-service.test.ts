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

test("WP33 waits for the /nix volume via /bin/sh before exec", () => {
  const xml = plistXml("/proj", "/proj/.mitori/cache/github-runner");
  const nix = "/nix/var/nix/profiles/default/bin/nix";
  expect(xml).toContain("<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string>");
  expect(xml).not.toContain(`<key>ProgramArguments</key><array><string>${nix}</string>`);
  expect(xml).toContain(`[ -x "${nix}" ]`);
  expect(xml).toContain("sleep 2");
  expect(xml).toContain("300");
  expect(xml).toContain("exit 1");
  expect(xml).toContain(`exec "${nix}" develop`);
  expect(xml).toContain("Runner.Listener");
});

test("WP33 keeps the existing plist keys unchanged", () => {
  const xml = plistXml("/proj", "/proj/.mitori/cache/github-runner");
  expect(xml).toContain("<key>WorkingDirectory</key><string>/proj</string>");
  expect(xml).toContain("<key>RUNNER_ROOT</key><string>/proj/.mitori/cache/github-runner</string>");
  expect(xml).toContain("<key>PATH</key><string>/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>");
  expect(xml).toContain("<key>ProcessType</key><string>Interactive</string>");
  expect(xml).toContain("<key>RunAtLoad</key><true/>");
  expect(xml).toContain("<key>KeepAlive</key><true/>");
  expect(xml).toContain("<key>ThrottleInterval</key><integer>60</integer>");
  expect(xml).toContain("<key>StandardOutPath</key><string>/proj/.mitori/cache/github-runner/service.log</string>");
  expect(xml).toContain("<key>StandardErrorPath</key><string>/proj/.mitori/cache/github-runner/service-error.log</string>");
});

test("WP33 survives spaces in paths without breaking the shell string", () => {
  const xml = plistXml("/proj with space", "/proj with space/.mitori/cache/github-runner");
  expect(xml).toContain("<key>WorkingDirectory</key><string>/proj with space</string>");
  expect(xml).toContain(`exec "/nix/var/nix/profiles/default/bin/nix" develop`);
});
