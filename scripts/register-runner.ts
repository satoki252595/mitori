// Register the Nix-pinned runner. Registration token goes through the environment, never argv/logs/Git.
import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".mitori/cache/github-runner");
mkdirSync(root, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);
const registration = Bun.spawn(["gh", "api", "--method", "POST", "repos/satoki252595/mitori/actions/runners/registration-token"], {
  stdout: "pipe",
  stderr: "pipe",
});
const [body, error, code] = await Promise.all([new Response(registration.stdout).text(), new Response(registration.stderr).text(), registration.exited]);
if (code !== 0) throw new Error(`runner registration failed: ${error.slice(-300)}`);
const { token } = JSON.parse(body) as { token: string };
if (!token) throw new Error("registration returned no token");
const runner = Bun.spawn(
  [
    "nix",
    "develop",
    ".#runner",
    "--command",
    "Runner.Listener",
    "configure",
    "--unattended",
    "--url",
    "https://github.com/satoki252595/mitori",
    "--name",
    "mitori-reference-mac",
    "--labels",
    "mitori-reference,macOS,ARM64",
    "--work",
    "_work",
    "--disableupdate",
  ],
  {
    env: { ...process.env, RUNNER_ROOT: root, ACTIONS_RUNNER_INPUT_TOKEN: token },
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(await runner.exited);
