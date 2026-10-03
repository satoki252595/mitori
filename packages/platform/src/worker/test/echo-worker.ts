// Worker entry for the WorkerPool tests.
import { serveWorker } from "../protocol.ts";

const me = crypto.randomUUID();

type Req = { op: "echo"; v: unknown } | { op: "who" } | { op: "throw" } | { op: "crash" } | { op: "sleep"; ms: number } | { op: "exit" };

serveWorker<Req, unknown>(async (req) => {
  switch (req.op) {
    case "echo":
      return req.v;
    case "who":
      return me;
    case "throw":
      throw new Error("handled failure");
    case "crash":
      setTimeout(() => {
        throw new Error("uncaught in worker");
      }, 0);
      return new Promise(() => {});
    case "exit":
      process.exit(3);
      break;
    case "sleep":
      await Bun.sleep(req.ms);
      return me;
  }
});
