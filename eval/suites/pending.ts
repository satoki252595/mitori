// Suites that are named by the spec but land in later milestones. They are registered so that `--suites cite,patch` is a
// recognised request and the report says plainly what did not run and which milestone brings it.
import { PENDING_SUITES, type RealSuite } from "../config.ts";
import type { RunSuite } from "./types.ts";

export const pendingSuite =
  (id: RealSuite): RunSuite =>
  async () => ({
    result: { id, status: "pending", checks: [], metrics: {}, notes: [PENDING_SUITES[id]] },
    slo: [],
  });
