/** Native auth-only execution after the CLI has verified the executable and obtained human TTY confirmation. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Auth output goes directly to the human terminal, never through mitori's capture/logging ports. */
export interface AuthSpawn {
  cmd: string[];
  env: Record<string, string>;
  stdin: "inherit";
  stdout: "inherit";
  stderr: "inherit";
}

/** Isolate the auth-only command from target repo discovery and remove its temporary working directory. */
export async function spawnOfficialLogin(
  spec: AuthSpawn,
  spawn: (spec: AuthSpawn & { cwd: string }) => Promise<number> = async (s) => Bun.spawn(s).exited,
): Promise<number> {
  const cwd = mkdtempSync(join(tmpdir(), "mitori-auth-"));
  try {
    return await spawn({ ...spec, stdin: "inherit", stdout: "inherit", stderr: "inherit", cwd });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
