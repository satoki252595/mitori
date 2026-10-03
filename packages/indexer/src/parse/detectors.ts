// Fact-detector registry seen by the parse Worker and the S0 scheduler (indexer spec §5.1: extract in the Worker while
// the tree is alive, link on the main thread).
// CR-PENDING(WP-02): integration point for WP-03 — the tier-1 detectors (`packages/indexer/src/facts/`) are added to
// `FACT_DETECTORS` when WP-02 and WP-03 are merged (docs/design/cr-requests/WP-02.md §2). Until then no detector runs and
// `ParseItemResult.facts` is empty.
import type { FactDetector, FactExtractInput } from "../contract.ts";

/** Detectors compiled into this build (id `<kind>.<name>@<ver>`). */
export const FACT_DETECTORS: readonly FactDetector[] = [];

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
