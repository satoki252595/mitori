<!--
  FloorPlan (contract `FloorPlanProps`, container mode in the MVP): renders `MapView` as one SVG string through
  PlanController; Svelte only passes state in. Exposes the controller for the map keys (zoom / pan / flow).
-->
<script lang="ts">
import type { MapView } from "@mitori/core";
import { onMount } from "svelte";
import "./plan.css";
import type { MapStore, ZoomStage } from "../contract.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { PlanController } from "./plan-dom.ts";
import { buildPlanModel, type PlanText } from "./render.ts";

let {
  view,
  text,
  selected,
  overlays,
  generating,
  done,
  pins,
  onselect,
  onopen,
  onstage,
  onhover,
  onzoom,
  controller = $bindable(null),
}: {
  view: MapView;
  text: PlanText;
  selected: string | null;
  overlays: MapStore["overlays"];
  generating: ReadonlySet<string>;
  done: ReadonlySet<string>;
  pins: Readonly<Record<string, number>>;
  onselect: (node: string | null) => void;
  onopen: (node: string) => void;
  onstage: (z: ZoomStage) => void;
  onhover: (node: string | null, rect: DOMRect | null) => void;
  onzoom?: (k: number) => void;
  controller?: PlanController | null;
} = $props();

let host: HTMLDivElement | undefined = $state();
const descId = "plan-desc";

onMount(() => {
  if (!host) return;
  const c = new PlanController(
    host,
    buildPlanModel(view),
    text,
    descId,
    { onselect, onopen, onstage, onhover, onzoom: (k) => onzoom?.(k) },
    view.diagram.kind === "floorplan" && !view.fallback,
  );
  controller = c;
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(host);
  markAfterPaint("mitori:map:painted");
  return () => {
    ro.disconnect();
    c.destroy();
    controller = null;
  };
});

// re-render only when the server view object changes
let lastView: MapView | null = null;
$effect(() => {
  const v = view;
  if (!controller || v === lastView) return;
  if (lastView !== null) controller.render(buildPlanModel(v), text, descId);
  lastView = v;
});
$effect(() => {
  const id = selected;
  controller?.select(id, false);
});
$effect(() => {
  if (!controller) return;
  controller.setClass("all-deps", overlays.allDeps);
  controller.setClass("fresh", overlays.freshness);
  controller.setClass("no-ai", !overlays.working);
  controller.setClass("no-pins", !overlays.comments);
});
$effect(() => {
  controller?.setRoomStates(generating, done);
});
$effect(() => {
  controller?.setPins(pins);
});
</script>

<div class="stage-host" bind:this={host}></div>
