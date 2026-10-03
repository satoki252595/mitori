// Contract-test plumbing (maintainer machine only): a Bun Spawner, node-fs ports, recording scrubber, schema checks.
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChildHandle, Spawner, SpawnSpec } from "@mitori/agent";
import type { FsReader, FsStat, SafeWriter } from "@mitori/core";

/** Lines of a byte stream (UTF-8 safe across chunk boundaries). */
async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += dec.decode(chunk, { stream: true });
    let i = buf.indexOf("\n");
    while (i >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
      i = buf.indexOf("\n");
    }
  }
  buf += dec.decode();
  if (buf.length > 0) yield buf;
}

/**
 * Minimal Spawner over Bun.spawn. CR-PENDING(WP-05): replace with @mitori/platform's Spawner once WP-01 lands (that one
 * also starts a process group so SIGKILL reaches grandchildren).
 */
export function bunSpawner(): Spawner {
  return {
    spawn(spec: SpawnSpec): ChildHandle {
      const p = Bun.spawn([spec.command, ...spec.argv], { cwd: spec.cwd, env: spec.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      let closed = false;
      return {
        pid: p.pid,
        stdout: lines(p.stdout),
        stderr: lines(p.stderr),
        exited: p.exited,
        write(text: string) {
          if (closed) throw new Error("stdin closed");
          p.stdin.write(text);
          p.stdin.flush();
        },
        closeStdin() {
          if (closed) return;
          closed = true;
          p.stdin.end();
        },
        kill(signal) {
          p.kill(signal);
        },
      };
    },
  };
}

/** node-fs SafeWriter/FsReader for the bench (atomic write, 0600 under `home`). */
export function nodeFsPorts(): { safeWrite: SafeWriter; fs: FsReader } {
  const stat = (abs: string): FsStat | null => {
    try {
      const s = lstatSync(abs, { bigint: true });
      return { size: Number(s.size), mtimeNs: s.mtimeNs, ino: s.ino, isFile: s.isFile(), isDir: s.isDirectory(), isSymlink: s.isSymbolicLink() };
    } catch {
      return null;
    }
  };
  return {
    safeWrite: {
      async write(root, rel, bytes, kind) {
        if (rel.includes("..") || rel.startsWith("/")) throw new Error(`bad rel ${rel}`);
        const p = join(root, rel);
        mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
        const tmp = `${p}.tmp-${process.pid}`;
        writeFileSync(tmp, bytes, { mode: kind === "home" ? 0o600 : 0o644 });
        renameSync(tmp, p);
      },
      async remove(root, rel) {
        rmSync(join(root, rel), { recursive: true, force: true });
      },
    },
    fs: {
      stat,
      read: async (abs) => new Uint8Array(readFileSync(abs)),
      readHead: async (abs, n) => new Uint8Array(readFileSync(abs)).slice(0, n),
      realpath: (abs) => {
        try {
          return realpathSync(abs);
        } catch {
          return null;
        }
      },
      readdir: (abs) => {
        try {
          return readdirSync(abs);
        } catch {
          return null;
        }
      },
    },
  };
}

/**
 * Scrub a recorded stream-json line for commit: absolute paths → placeholders, thinking signatures (they embed account
 * ids) and socket paths removed. Returns null for non-JSON lines (kept out of recordings).
 */
export function scrubLine(line: string, repl: readonly [string, string][]): string | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  const sorted = [...repl].filter(([a]) => a.length > 1).sort((a, b) => b[0].length - a[0].length);
  const walk = (x: unknown, key?: string): unknown => {
    if (typeof x === "string") {
      if (key === "signature" || key === "messaging_socket_path") return "<scrubbed>";
      let s = x;
      for (const [a, b] of sorted) s = s.split(a).join(b);
      // fragments of temp paths split across deltas, and their ~/.claude/projects slug form
      return s.replace(/(?:\/private)?\/var\/folders\/[^"\\\s]*/g, "$TMP").replace(/-(?:private-)?var-folders-[A-Za-z0-9-]*/g, "-TMP");
    }
    if (Array.isArray(x)) return x.map((e) => walk(e));
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, e]) => [k, walk(e, k)]));
    return x;
  };
  return JSON.stringify(walk(v));
}

/** JSON-Schema subset used by `schemas/claude/*.schema.json` (type, required, properties, enum, items, const). */
export function validate(schema: Record<string, unknown>, value: unknown, path = "$"): string[] {
  const errs: string[] = [];
  const t = schema.type as string | string[] | undefined;
  const typeOf = (v: unknown) =>
    v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
  if (t) {
    const ok = (Array.isArray(t) ? t : [t]).some((x) => x === typeOf(value) || (x === "number" && typeOf(value) === "integer"));
    if (!ok) return [`${path}: expected ${String(t)}, got ${typeOf(value)}`];
  }
  if (schema.const !== undefined && value !== schema.const) errs.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const r of (schema.required as string[] | undefined) ?? []) if (!(r in o)) errs.push(`${path}.${r}: missing`);
    for (const [k, s] of Object.entries((schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {})) {
      if (k in o) errs.push(...validate(s, o[k], `${path}.${k}`));
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((e, i) => {
      errs.push(...validate(schema.items as Record<string, unknown>, e, `${path}[${i}]`));
    });
  }
  return errs;
}
