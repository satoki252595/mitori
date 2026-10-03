// macOS process memory for the benches (CR m1-117: darwin RSS counts freed-but-resident pages, `phys_footprint` is what
// the system charges): `proc_pid_rusage(RUSAGE_INFO_V4)` gives the current and the LIFETIME MAX physical footprint, so a
// peak needs no sampling. null on other platforms.
import { dlopen, FFIType, ptr } from "bun:ffi";

const RUSAGE_INFO_V4 = 4;
// struct rusage_info_v4 offsets (sys/resource.h)
const OFF_RESIDENT = 64;
const OFF_FOOTPRINT = 72;
const OFF_LIFETIME_MAX_FOOTPRINT = 240;

let lib: { symbols: { proc_pid_rusage: (pid: number, flavor: number, buf: number) => number } } | null | undefined;

function libproc() {
  if (lib !== undefined) return lib;
  if (process.platform !== "darwin") {
    lib = null;
    return lib;
  }
  try {
    lib = dlopen("/usr/lib/libproc.dylib", {
      proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    }) as unknown as typeof lib;
  } catch {
    lib = null;
  }
  return lib;
}

export interface Footprint {
  /** Current resident size (what `ps` / `process.memoryUsage().rss` report), bytes. */
  resident: number;
  /** Current physical footprint, bytes. */
  footprint: number;
  /** Highest physical footprint since the process started, bytes. */
  peakFootprint: number;
}

/** This process's memory, or null when unavailable. */
export function footprint(pid = process.pid): Footprint | null {
  const l = libproc();
  if (l === null || l === undefined) return null;
  const buf = new BigUint64Array(64);
  if (l.symbols.proc_pid_rusage(pid, RUSAGE_INFO_V4, ptr(buf) as unknown as number) !== 0) return null;
  const at = (off: number) => Number(buf[off / 8]);
  return { resident: at(OFF_RESIDENT), footprint: at(OFF_FOOTPRINT), peakFootprint: at(OFF_LIFETIME_MAX_FOOTPRINT) };
}
