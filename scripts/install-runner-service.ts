// macOS user LaunchAgent. The executable and dependencies remain in the project's pinned Nix shell.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin") throw new Error("the reference runner service is for macOS");
const project = resolve(".");
const runnerRoot = join(project, ".mitori/cache/github-runner");
const label = "io.mitori.reference-runner";
const directory = join(homedir(), "Library/LaunchAgents");
const path = join(directory, `${label}.plist`);
const xmlEscape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
mkdirSync(directory, { recursive: true });
writeFileSync(
  path,
  `<?xml version="1.0" encoding="UTF-8"?>
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
`,
  { mode: 0o600 },
);
const uid = process.getuid?.();
if (uid === undefined) throw new Error("macOS uid is unavailable");
const remove = Bun.spawn(["launchctl", "bootout", `gui/${uid}/${label}`], { stdout: "ignore", stderr: "ignore" });
await remove.exited;
const start = Bun.spawn(["launchctl", "bootstrap", `gui/${uid}`, path], { stdout: "inherit", stderr: "inherit" });
if ((await start.exited) !== 0) throw new Error("runner LaunchAgent bootstrap failed");
console.log(`registered ${label}; stop: launchctl bootout gui/${uid}/${label}`);
