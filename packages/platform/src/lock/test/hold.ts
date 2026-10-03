// Child for PLAT-I-004: takes the lock given as argv[2], prints "locked", then waits to be killed.
import { acquireLock } from "../lockfile.ts";

const r = await acquireLock(process.argv[2] as string, { pid: process.pid, startedAt: new Date().toISOString(), port: 0 });
console.log(r.ok ? "locked" : "busy");
setInterval(() => {}, 60_000);
