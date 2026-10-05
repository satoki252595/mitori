/** Older daemons have no presentation DTO; charge its derivation/serializer only for those responses. */
import type { MapView, UiLang, WorkspaceKey } from "@mitori/core";
import { buildPlanModel, mapSvgPresentation, planData } from "@mitori/core";

export function legacyPresentation(view: MapView, ws: WorkspaceKey, lang: UiLang) {
  const model = buildPlanModel(view);
  return { plan: view.plan ?? planData(model), svg: view.svg ?? mapSvgPresentation(view, ws, lang, model) };
}
