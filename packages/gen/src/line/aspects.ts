/** Aspect metadata the compact line form derives server-side (PT-03). */
import type { Audience, BlockAspect, BlockKind } from "@mitori/core";
import { ASPECT_DEFAULTS, SECTION_ASPECTS } from "@mitori/doc";

/**
 * Default audience per aspect (gen spec §5.6 per-prompt "Audience" rules).
 * CR-PENDING(WP-06): the contract says kind/depth/audience come from `ASPECT_DEFAULTS`, which has no audience;
 * this table is the local stand-in until `ASPECT_DEFAULTS[a].audience` exists (cr-requests/WP-06.md R1).
 */
export const ASPECT_AUDIENCE: Readonly<Record<BlockAspect, readonly Audience[]>> = {
  tldr: ["newcomer", "pm", "dev"],
  problem: ["newcomer", "pm", "dev"],
  users: ["newcomer", "pm", "dev"],
  scope: ["newcomer", "pm", "dev"],
  constraints: ["newcomer", "pm", "dev"],
  caption: ["newcomer", "pm", "dev"],
  intro: ["newcomer", "dev"],
  summary: ["newcomer", "pm", "dev"],
  sequence: ["dev"],
  steps: ["dev", "reviewer"],
  edge_cases: ["reviewer", "dev"],
  learn: ["newcomer", "dev"],
  responsibility: ["newcomer", "dev"],
  interface: ["dev"],
  dependencies: ["dev"],
  data: ["dev"],
  flow: ["dev"],
  config: ["dev"],
  tests: ["dev"],
  invariants: ["reviewer", "dev"],
  errors: ["reviewer", "dev"],
  concurrency: ["reviewer", "dev"],
  performance: ["reviewer", "dev"],
  pitfalls: ["dev"],
  deepdive: ["reviewer", "dev"],
  files: ["reviewer", "dev"],
  recap: ["newcomer", "dev"],
  structure: ["dev"],
  interactions: ["dev"],
  overview: ["dev", "reviewer", "pm"],
  entities: ["dev", "reviewer"],
  lifecycle: ["dev", "reviewer"],
  migrations: ["dev", "reviewer"],
  hotpaths: ["reviewer", "sre", "dev"],
  caching: ["reviewer", "sre", "dev"],
  limits: ["reviewer", "sre", "dev"],
  security: ["reviewer", "sre", "dev"],
  reliability: ["reviewer", "sre", "dev"],
  observability: ["reviewer", "sre", "dev"],
  decision: ["reviewer", "dev", "pm"],
  debt: ["reviewer", "dev", "pm"],
  untested: ["reviewer", "dev", "pm"],
  hotspots: ["reviewer", "dev", "pm"],
  fragile: ["reviewer", "dev", "pm"],
};

/** Every aspect name. */
export const BLOCK_ASPECTS: ReadonlySet<string> = new Set(Object.keys(ASPECT_DEFAULTS));

/** Allowed kinds of an aspect. */
export function kindsOf(aspect: BlockAspect): readonly BlockKind[] {
  return ASPECT_DEFAULTS[aspect].kinds;
}

/** Allowed aspects of a section; `s6/<slug>` depends on whether the page is a leaf or a parent module. */
export function sectionAspects(section: string, s6: "leaf" | "parent"): readonly BlockAspect[] {
  if (section.startsWith("s3/")) return SECTION_ASPECTS["s3/*"];
  if (section.startsWith("s6/")) return s6 === "leaf" ? SECTION_ASPECTS["s6/leaf"] : SECTION_ASPECTS["s6/parent"];
  return (SECTION_ASPECTS as Readonly<Record<string, readonly BlockAspect[]>>)[section] ?? [];
}
