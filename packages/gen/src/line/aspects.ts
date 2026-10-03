/** Aspect metadata the compact line form derives server-side (PT-03). */
import type { BlockAspect, BlockKind } from "@mitori/core";
import { ASPECT_DEFAULTS, SECTION_ASPECTS } from "@mitori/doc";

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
