import { STRUCTURE_PARAMS } from "../contract.ts";

/** The size / search knobs of S3 (defaults = contract STRUCTURE_PARAMS; tests use {@link TEST_TUNING}). */
export interface Tuning {
  leafLocMin: number;
  leafLocTarget: number;
  leafLocMax: number;
  leafLocHard: number;
  leafSkeletonTokensMax: number;
  fanoutTarget: number;
  fanoutMin: number;
  fanoutMax: number;
  maxDepth: number;
  gammaMin: number;
  gammaMax: number;
  gammaSteps: number;
  hysteresis: number;
  maxLevels: number;
}

export const DEFAULT_TUNING: Tuning = {
  leafLocMin: STRUCTURE_PARAMS.leafLocMin,
  leafLocTarget: STRUCTURE_PARAMS.leafLocTarget,
  leafLocMax: STRUCTURE_PARAMS.leafLocMax,
  leafLocHard: STRUCTURE_PARAMS.leafLocHard,
  leafSkeletonTokensMax: STRUCTURE_PARAMS.leafSkeletonTokensMax,
  fanoutTarget: STRUCTURE_PARAMS.fanoutTarget,
  fanoutMin: STRUCTURE_PARAMS.fanoutMin,
  fanoutMax: STRUCTURE_PARAMS.fanoutMax,
  maxDepth: STRUCTURE_PARAMS.maxDepth,
  gammaMin: STRUCTURE_PARAMS.gammaMin,
  gammaMax: STRUCTURE_PARAMS.gammaMax,
  gammaSteps: STRUCTURE_PARAMS.gammaSteps,
  hysteresis: STRUCTURE_PARAMS.hysteresis,
  maxLevels: STRUCTURE_PARAMS.maxLevels,
};

/** Fixture truth module constraints are written for these (testing spec §2.4: leafMinLoc 50, leafMaxLoc 300). */
export const TEST_TUNING: Tuning = { ...DEFAULT_TUNING, leafLocMin: 50, leafLocTarget: 150, leafLocMax: 300, leafLocHard: 450 };
