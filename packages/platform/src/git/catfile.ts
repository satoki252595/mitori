// One persistent `git cat-file --batch` per reader (PT-17): requests are written to stdin, responses parsed in order
// from stdout (`<oid> <type> <size>\n<bytes>\n` or `<oid> missing\n`). Restarted on demand after an exit.
import { MitoriError } from "@mitori/core";

/** One parsed object. */
export interface CatObject {
  /** `blob`, `tree`, `commit`, `tag`. */
  type: string;
  /** Content. */
  bytes: Uint8Array;
}

interface Pending {
  oid: string;
  resolve(o: CatObject | null): void;
  reject(err: unknown): void;
}

/** FIFO byte buffer over received chunks. */
class Bytes {
  private chunks: Uint8Array[] = [];
  private off = 0; // read offset into chunks[0]
  length = 0;

  push(c: Uint8Array): void {
    if (c.byteLength === 0) return;
    this.chunks.push(c);
    this.length += c.byteLength;
  }

  /** Index (from the read position) of the first `byte`, or -1. */
  indexOf(byte: number): number {
    let base = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i] as Uint8Array;
      const from = i === 0 ? this.off : 0;
      const at = c.indexOf(byte, from);
      if (at >= 0) return base + at - from;
      base += c.byteLength - from;
    }
    return -1;
  }

  /** Remove and return the next `n` bytes (n ≤ length). */
  take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const c = this.chunks[0] as Uint8Array;
      const avail = c.byteLength - this.off;
      const k = Math.min(avail, n - filled);
      out.set(c.subarray(this.off, this.off + k), filled);
      filled += k;
      this.off += k;
      if (this.off === c.byteLength) {
        this.chunks.shift();
        this.off = 0;
      }
    }
    this.length -= n;
    return out;
  }
}

const dec = new TextDecoder();

/** Persistent batch reader. `argv` = full git argv ending in `cat-file --batch`. */
export class CatFileBatch {
  private proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "ignore">> | null = null;
  private pending: Pending[] = [];
  private buf = new Bytes();
  private header: { type: string; size: number } | null = null;

  constructor(
    private readonly argv: string[],
    private readonly cwd: string,
    private readonly env: Record<string, string>,
  ) {}

  /** Object by full hex id; null when missing. */
  get(oid: string): Promise<CatObject | null> {
    return new Promise((resolve, reject) => {
      const proc = this.ensure();
      this.pending.push({ oid, resolve, reject });
      proc.stdin.write(`${oid}\n`);
      void Promise.resolve(proc.stdin.flush()).catch(() => {});
    });
  }

  /** Stop the process (pending requests fail). */
  close(): void {
    const p = this.proc;
    this.proc = null;
    if (p) {
      try {
        void Promise.resolve(p.stdin.end()).catch(() => {});
      } catch {}
      p.kill("SIGTERM");
    }
    this.fail(new MitoriError("E_GIT_FAILED", "cat-file --batch closed"));
  }

  private ensure() {
    if (this.proc) return this.proc;
    let proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "ignore">>;
    try {
      proc = Bun.spawn(this.argv, { cwd: this.cwd, env: this.env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? "?";
      throw new MitoriError(code === "ENOENT" ? "E_NOT_FOUND" : "E_GIT_FAILED", `cannot start git cat-file --batch (${code})`, { cause, params: { code } });
    }
    this.proc = proc;
    this.buf = new Bytes();
    this.header = null;
    void (async () => {
      try {
        for await (const chunk of proc.stdout) {
          if (this.proc !== proc) break; // closed/replaced: late bytes must not reach the next process's parser
          this.buf.push(chunk);
          this.drain();
        }
      } catch {}
      if (this.proc === proc) {
        this.proc = null;
        this.fail(new MitoriError("E_GIT_FAILED", "cat-file --batch exited", { retryable: true }));
      }
    })();
    return proc;
  }

  private drain(): void {
    for (;;) {
      if (!this.header) {
        const nl = this.buf.indexOf(10);
        if (nl < 0) return;
        const line = dec.decode(this.buf.take(nl + 1)).slice(0, -1);
        const req = this.pending[0];
        const parts = line.split(" ");
        if (parts.length === 2 && (parts[1] === "missing" || parts[1] === "ambiguous")) {
          this.pending.shift();
          req?.resolve(null);
          continue;
        }
        const size = Number(parts[2]);
        if (parts.length !== 3 || !Number.isInteger(size)) {
          this.pending.shift();
          req?.reject(new MitoriError("E_GIT_FAILED", `cat-file: unexpected header ${JSON.stringify(line.slice(0, 80))}`));
          continue;
        }
        this.header = { type: parts[1] as string, size };
      }
      const h = this.header;
      if (this.buf.length < h.size + 1) return;
      const bytes = this.buf.take(h.size);
      this.buf.take(1); // trailing LF
      this.header = null;
      this.pending.shift()?.resolve({ type: h.type, bytes });
    }
  }

  private fail(err: unknown): void {
    for (const p of this.pending.splice(0)) p.reject(err);
  }
}
