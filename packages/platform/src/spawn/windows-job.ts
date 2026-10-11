import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { MitoriError } from "@mitori/core";

/** Verified, private extracted native asset. The executable is never resolved from a repository or PATH. */
export interface WindowsJobLauncher {
  path: string;
  sha256: string;
}

/** Values stay in the environment, never argv; single-process mode keeps descendants outside the leader's job. */
export function windowsJobArgv(command: string, argv: readonly string[], env: Readonly<Record<string, string>>, processGroup = true): string[] {
  const names = Object.keys(env);
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toUpperCase();
    if (!name || /[=\0]/u.test(name) || seen.has(key)) throw new MitoriError("E_INVALID_INPUT", "Windows job environment names must be valid and unique");
    seen.add(key);
  }
  return [...(processGroup ? [] : ["--single-process"]), "--env-count", String(names.length), ...names, "--", command, ...argv];
}

/** Validate at each use as for pinned engines; fail closed if the immutable private asset was replaced. */
export function windowsJobExecutable(asset: WindowsJobLauncher | undefined): string {
  if (!asset || !isAbsolute(asset.path) || !/^[a-f0-9]{64}$/u.test(asset.sha256))
    throw new MitoriError("E_UNSUPPORTED", "Windows children require the verified native Job Object launcher");
  try {
    const path = realpathSync(asset.path);
    if (path !== resolve(asset.path)) throw new MitoriError("E_PATH_SYMLINK", "Windows Job Object launcher must have a canonical non-symlink path");
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n || before.size > 2n * 1024n * 1024n)
      throw new MitoriError("E_PRECONDITION", "Windows Job Object launcher is not a regular bounded native asset");
    const bytes = readFileSync(path);
    const after = lstatSync(path, { bigint: true });
    if (
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      realpathSync(asset.path) !== path ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256
    )
      throw new MitoriError("E_PRECONDITION", "Windows Job Object launcher changed; restore the verified embedded asset");
    return path;
  } catch (cause) {
    if (cause instanceof MitoriError) throw cause;
    throw new MitoriError("E_PRECONDITION", "Windows Job Object launcher is unavailable", { cause });
  }
}
