// macOS user LaunchAgent. The executable and dependencies remain in the project's pinned Nix shell.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const label = "io.mitori.reference-runner";

/** `launchctl bootstrap` right after `bootout` fails with `Bootstrap failed: 5` at times; a retry seconds later succeeds. */
export const BOOTSTRAP_ATTEMPTS = 5;
export const BOOTSTRAP_RETRY_MS = 1000;

export interface BootstrapHooks {
  bootout?: () => Promise<void>;
  bootstrap?: () => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
}

/** Bootstrap, retrying a few times at a short interval. Throws with the manual recovery command when all fail. */
export async function bootstrapWithRetry(
  domain: string,
  plistPath: string,
  hooks: {
    bootstrap: () => Promise<number>;
    sleep?: ((ms: number) => Promise<void>) | undefined;
    attempts?: number | undefined;
    intervalMs?: number | undefined;
  },
): Promise<void> {
  const attempts = hooks.attempts ?? BOOTSTRAP_ATTEMPTS;
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const intervalMs = hooks.intervalMs ?? BOOTSTRAP_RETRY_MS;
  for (let i = 1; i <= attempts; i++) {
    if ((await hooks.bootstrap()) === 0) return;
    if (i < attempts) await sleep(intervalMs);
  }
  throw new Error(
    `runner LaunchAgent bootstrap failed ${attempts} times; the runner is not registered. Restore it by hand: launchctl bootstrap ${domain} ${plistPath}`,
  );
}

export function plistXml(project: string, runnerRoot: string): string {
  const xmlEscape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/nix/var/nix/profiles/default/bin/nix</string><string>develop</string><string>.#runner</string><string>--command</string><string>Runner.Listener</string><string>run</string></array>
<key>WorkingDirectory</key><string>${xmlEscape(project)}</string>
<key>EnvironmentVariables</key><dict><key>RUNNER_ROOT</key><string>${xmlEscape(runnerRoot)}</string><key>PATH</key><string>/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>ProcessType</key><string>Interactive</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>${xmlEscape(join(runnerRoot, "service.log"))}</string>
<key>StandardErrorPath</key><string>${xmlEscape(join(runnerRoot, "service-error.log"))}</string>
</dict></plist>
`;
}

export async function installRunnerService(hooks: BootstrapHooks = {}): Promise<void> {
  if (process.platform !== "darwin") throw new Error("the reference runner service is for macOS");
  const project = resolve(".");
  const runnerRoot = join(project, ".mitori/cache/github-runner");
  const directory = join(homedir(), "Library/LaunchAgents");
  const path = join(directory, `${label}.plist`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, plistXml(project, runnerRoot), { mode: 0o600 });
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("macOS uid is unavailable");
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  if (hooks.bootout) await hooks.bootout();
  else {
    const remove = Bun.spawn(["launchctl", "bootout", target], { stdout: "ignore", stderr: "ignore" });
    await remove.exited;
  }
  const bootstrap =
    hooks.bootstrap ??
    (async () => {
      const start = Bun.spawn(["launchctl", "bootstrap", domain, path], { stdout: "inherit", stderr: "inherit" });
      return start.exited;
    });
  await bootstrapWithRetry(domain, path, { bootstrap, sleep: hooks.sleep });
  console.log(`registered ${label}; stop: launchctl bootout gui/${uid}/${label}`);
}

if (import.meta.main) await installRunnerService();
