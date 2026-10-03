// Fact-detector registry seen by the parse Worker and the S0 scheduler (indexer spec §5.1: extract in the Worker while
// the tree is alive, link on the main thread).
// WP-INT: the tier-1 detectors of WP-03 (`packages/indexer/src/facts/registry.ts`) are compiled in here
// (docs/design/cr-requests/WP-02.md §2).
import type { FactDetector, FactExtractInput } from "../contract.ts";
import { FACT_DETECTORS as TIER1_DETECTORS } from "../facts/registry.ts";

/** Detectors compiled into this build (id `<kind>.<name>@<ver>`). */
export const FACT_DETECTORS: readonly FactDetector[] = TIER1_DETECTORS;

const byId = new Map<string, FactDetector>();
for (const d of FACT_DETECTORS) byId.set(d.id, d);

/** Detector by id (Worker side). */
export function detectorById(id: string): FactDetector | undefined {
  return byId.get(id);
}

/** Ids of the enabled detectors that apply to a file (main thread, before batching). */
export function detectorsFor(file: FactExtractInput["file"], enabled: ReadonlySet<string> | null = null): string[] {
  const out: string[] = [];
  for (const d of FACT_DETECTORS) if ((enabled === null || enabled.has(d.id)) && d.appliesTo(file)) out.push(d.id);
  return out;
}

/** Detector-set version (`idx_fact_cands.detectors`): the sorted ids, hashed by the caller. */
export function detectorSetKey(): string {
  return FACT_DETECTORS.map((d) => d.id)
    .sort()
    .join("\n");
}
