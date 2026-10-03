import type { Effort } from "@mitori/core";

/** The three generation efforts, in tile order (shared by the store and the estimate card without pulling the card logic into the entry chunk). */
export const EFFORTS: readonly Effort[] = ["overview", "standard", "complete"];
