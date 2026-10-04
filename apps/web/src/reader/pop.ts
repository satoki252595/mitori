/**
 * Lazy part of S2 (a second `reader` chunk, prefetched when the page is idle after its first paint): the cite
 * peek, the glossary card, the claim popover and the block history — opened on hover / click, never needed for
 * the first paint.
 */
export { default as BlockHistory } from "./BlockHistory.svelte";
export { default as CitePeek } from "./CitePeek.svelte";
export { default as ClaimPopover } from "./ClaimPopover.svelte";
export { default as PeekVerify } from "./PeekVerify.svelte";
export { default as TermCard } from "./TermCard.svelte";
