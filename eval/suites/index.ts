import type { RealSuite } from "../config.ts";
import { pendingSuite } from "./pending.ts";
import { runSmoke } from "./smoke.ts";
import type { RunSuite } from "./types.ts";

export const SUITE_REGISTRY: Readonly<Record<RealSuite | "smoke", RunSuite>> = {
  smoke: runSmoke,
  cite: pendingSuite("cite"),
  patch: pendingSuite("patch"),
  tokens: pendingSuite("tokens"),
  quiz: pendingSuite("quiz"),
};

export const isSuite = (name: string): name is keyof typeof SUITE_REGISTRY => name in SUITE_REGISTRY;
