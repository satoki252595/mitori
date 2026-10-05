<!--
  FloorPlan (contract `FloorPlanProps`, container mode in the MVP): renders `MapView` as one SVG string through
  PlanController; Svelte only passes state in. Exposes the controller for the map keys (zoom / pan / flow).
-->
<script lang="ts">
import type { MapView } from "@mitori/core";
import { onMount, untrack } from "svelte";
import "./plan.css";
import type { MapStore, ZoomStage } from "../contract.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { PlanController } from "./plan-dom.ts";
import { type FlowStep, hydratePlan, type PlanText } from "./render.ts";

let {
  view,
  text,
  selected,
  overlays,
  generating,
  done,
  pins,
  flow = null,
  onselect,
  onopen,
  onstage,
  onhover,
  onzoom,
  controller = $bindable(null),
  initialCamera = null,
}: {
  view: MapView;
  text: PlanText;
  selected: string | null;
  overlays: MapStore["overlays"];
  generating: ReadonlySet<string>;
  done: ReadonlySet<string>;
  pins: Readonly<Record<string, number>>;
  flow?: readonly FlowStep[] | null;
  onselect: (node: string | null) => void;
  onopen: (node: string) => void;
  onstage: (z: ZoomStage) => void;
  onhover: (node: string | null, rect: DOMRect | null) => void;
  onzoom?: (k: number) => void;
  controller?: PlanController | null;
  initialCamera?: import("../contract.ts").MapCamera | null;
} = $props();

let host: HTMLDivElement | undefined = $state();
const descId = "plan-desc";
const initialSvg = import.meta.env.SSR ? untrack(() => view.svg ?? "") : "";

let lastView: MapView | null = null;
onMount(() => {
  if (!host) return;
  const c = new PlanController(
    host,
    hydratePlan(view.plan!),
    text,
    descId,
    { onselect, onopen, onstage, onhover, onzoom: (k) => onzoom?.(k) },
    view.diagram.kind === "floorplan" && !view.fallback,
    view.svg!,
  );
  if (initialCamera) c.restoreCamera(initialCamera);
  lastView = view;
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
$effect(() => {
  const v = view;
  const c = controller;
  if (!c || v === lastView) return;
  lastView = v;
  c.render(hydratePlan(v.plan!), text, descId, v.svg!);
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
$effect(() => {
  controller?.setFlow(flow);
});
</script>

<div class="stage-host" bind:this={host}>{@html initialSvg}</div>
