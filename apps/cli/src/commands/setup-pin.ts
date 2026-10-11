/** Prepare a human-reviewed executable pin without authentication or model requests. */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, parse } from "node:path";
import type { BinaryPin } from "@mitori/core";
import { createHasher, createSpawner } from "@mitori/platform";
import { type Io, usage } from "./io.ts";

const VERSION_TIMEOUT_MS = 5_000;
const VERSION_MAX_BYTES = 4_096;

export async function prepareProviderPin(binary: string, io: Io, provider: "Claude" | "Codex"): Promise<BinaryPin> {
  if (!isAbsolute(binary)) throw usage(`${provider} needs an absolute executable path`);
  const realpath = realpathSync(binary);
  if (!statSync(realpath).isFile()) throw usage(`the ${provider} executable must be a regular file`);
  const hasher = createHasher();
  const sha256 = hasher.sha256(readFileSync(realpath));
  // --version needs no credentials. The filesystem root avoids target repository configuration.
  const env: Record<string, string> = { PATH: process.platform === "win32" ? (io.env.PATH ?? "") : "/usr/bin:/bin" };
  for (const name of ["HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP"]) if (io.env[name] !== undefined) env[name] = io.env[name];
  const proc = createSpawner().spawn({
    command: realpath,
    argv: ["--version"],
    cwd: parse(realpath).root,
    env,
    stdin: "",
    keepStdinOpen: false,
    timeoutMs: VERSION_TIMEOUT_MS,
    processGroup: process.platform !== "win32",
  });
  const kill = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      // The process group may already have exited.
    }
  };
  // Discard account details from stderr while preventing an unread pipe from blocking the probe.
  void (async () => {
    for await (const _ of proc.stderr) {
      // Intentionally discarded.
    }
  })().catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const capture = async () => {
      const lines: string[] = [];
      let bytes = 0;
      for await (const line of proc.stdout) {
        bytes += new TextEncoder().encode(line).byteLength + 1;
        if (bytes > VERSION_MAX_BYTES) throw usage(`${provider} --version returned too much output`);
        lines.push(line);
      }
      if ((await proc.exited) !== 0) throw usage(`${provider} --version failed; verify the selected executable`);
      const version = lines[0]?.trim() ?? "";
      if (!version || version.length > 512 || [...version].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
        throw usage(`${provider} --version did not return a valid version line`);
      return version;
    };
    const version = await Promise.race([
      capture(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(usage(`${provider} --version timed out`)), VERSION_TIMEOUT_MS);
      }),
    ]);
    if (realpathSync(binary) !== realpath || hasher.sha256(readFileSync(realpath)) !== sha256)
      throw usage(`the ${provider} executable changed during verification; retry setup`);
    return { path: binary, realpath, sha256, version, pinnedAt: io.clock.iso(), by: "user" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    kill();
  }
}
