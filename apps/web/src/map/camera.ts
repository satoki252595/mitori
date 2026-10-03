/**
 * Map camera (ux.md §4.2.3): screen = world × s + (x, y). Only `<g transform>` and `--inv-s` are written to the
 * DOM; everything here is pure. Zoom stage from `k = s / s_fit`; label LOD from on-screen room size (`ROOM_LOD`).
 */
import { type MapCamera, ROOM_LOD, UI_THRESHOLDS, type ZoomStage } from "../contract.ts";

export const K_MIN = 0.25;
export const K_MAX = 4;
/** Target k of each stage for the `=` / `-` keys and the segmented control. */
export const STAGE_K: Record<ZoomStage, number> = { Z0: 0.5, Z1: 0.76, Z2: 1, Z3: 2.2 };

export interface Viewport {
  w: number;
  h: number;
}

/**
 * Largest fit scale: a small repository is centred at a comfortable size instead of filling a big stage with
 * huge empty rooms (labels keep their on-screen size whatever the scale).
 */
export const FIT_MAX_S = 1.3;

export function fitCamera(contentW: number, contentH: number, vp: Viewport, pad = 24, maxS = Number.POSITIVE_INFINITY): MapCamera {
  const s = Math.max(1e-3, Math.min(maxS, (vp.w - pad * 2) / Math.max(1, contentW), (vp.h - pad * 2) / Math.max(1, contentH)));
  return { s, x: (vp.w - contentW * s) / 2, y: (vp.h - contentH * s) / 2 };
}

export function stageOf(k: number, anyLg: boolean, allowZ3: boolean): ZoomStage {
  if (k < UI_THRESHOLDS.mapZoomK.z0) return "Z0";
  if (k < UI_THRESHOLDS.mapZoomK.z1) return "Z1";
  return allowZ3 && anyLg ? "Z3" : "Z2";
}

/** Zoom by `factor` keeping screen point (px, py) fixed; k clamped to [K_MIN, K_MAX] of `sFit`. */
export function zoomAt(cam: MapCamera, factor: number, px: number, py: number, sFit: number): MapCamera {
  const s = Math.min(K_MAX * sFit, Math.max(K_MIN * sFit, cam.s * factor));
  const f = s / cam.s;
  return { s, x: px - (px - cam.x) * f, y: py - (py - cam.y) * f };
}

/** Camera at stage k centred on the viewport centre. */
export function cameraForK(cam: MapCamera, k: number, sFit: number, vp: Viewport): MapCamera {
  return zoomAt(cam, (k * sFit) / cam.s, vp.w / 2, vp.h / 2, sFit);
}

/** One stage up (`=`) / down (`-`) from the current k (container mode tops out at Z2's k range). */
export function stepStageK(k: number, dir: 1 | -1, allowZ3: boolean): number {
  const order: ZoomStage[] = allowZ3 ? ["Z0", "Z1", "Z2", "Z3"] : ["Z0", "Z1", "Z2"];
  const ks = order.map((z) => STAGE_K[z]);
  if (dir > 0) return ks.find((v) => v > k + 1e-6) ?? Math.min(K_MAX, k * 1.6);
  for (let i = ks.length - 1; i >= 0; i--) if ((ks[i] as number) < k - 1e-6) return ks[i] as number;
  return Math.max(K_MIN, k / 1.6);
}

export function pan(cam: MapCamera, dx: number, dy: number): MapCamera {
  return { s: cam.s, x: cam.x + dx, y: cam.y + dy };
}

/** Camera that centres the world rect at scale `s`. */
export function centreOn(rect: { x: number; y: number; w: number; h: number }, s: number, vp: Viewport): MapCamera {
  return { s, x: vp.w / 2 - (rect.x + rect.w / 2) * s, y: vp.h / 2 - (rect.y + rect.h / 2) * s };
}

/** Interpolated camera at t ∈ [0,1] (ease-out cubic; scale in log space). */
export function lerpCamera(a: MapCamera, b: MapCamera, t: number): MapCamera {
  const e = 1 - (1 - t) ** 3;
  const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * e);
  // keep the world point under the viewport centre moving linearly between the endpoints
  return { s, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

export type LodClass = "xxs" | "xs" | "sm" | "md" | "lg";

export function lodClass(screenW: number, screenH: number): LodClass {
  if (screenW >= UI_THRESHOLDS.roomLg.w && screenH >= UI_THRESHOLDS.roomLg.h) return "lg";
  for (const r of ROOM_LOD) if (screenW <= r.maxW || screenH <= r.maxH) return r.cls;
  return "md";
}

export function cameraTransform(c: MapCamera): string {
  return `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${c.s.toFixed(5)})`;
}
