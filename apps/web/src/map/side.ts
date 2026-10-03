/**
 * Lazy part of S1 (chunk `gen`, loaded right after the map chunk mounts): the generation card states, the room
 * card and the text view. None of them is needed for the first paint (the card column shows a same-size skeleton
 * meanwhile), so the map chunk stays the plan + page shell.
 */
export { default as GenEstimateCard } from "../gen/GenEstimateCard.svelte";
export { default as GenProgress } from "../gen/GenProgress.svelte";
export { default as EngineCard } from "./EngineCard.svelte";
export { default as RoomCard } from "./RoomCard.svelte";
export { default as TextViewDialog } from "./TextViewDialog.svelte";
