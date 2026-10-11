/**
 * Lazy generation card shell. Optional room/dialog/progress/error views load only when their state is shown.
 * The server supplies these parts synchronously for canonical initial markup.
 */

export { default as SidePanel } from "./SidePanel.svelte";

export interface MapSide {
  SidePanel: typeof import("./SidePanel.svelte").default;
  RoomCard?: typeof import("./RoomCard.svelte").default | undefined;
  TextViewDialog?: typeof import("./TextViewDialog.svelte").default | undefined;
  GenProgress?: typeof import("../gen/GenProgress.svelte").default | undefined;
  EngineCard?: typeof import("./EngineCard.svelte").default | undefined;
  GenBreakdown?: typeof import("../gen/GenBreakdown.svelte").default | undefined;
  GenDoneCard?: typeof import("../gen/GenDoneCard.svelte").default | undefined;
}
