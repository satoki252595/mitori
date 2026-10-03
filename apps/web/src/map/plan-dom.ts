/**
 * Imperative controller of the map SVG (ux.md §4.2.3): one innerHTML write per MapView, then only the camera
 * transform, `--inv-s`, LOD attributes and state classes change. Kept out of the Svelte component so per-frame
 * camera updates never touch reactivity.
 */
import type { MapCamera, ZoomStage } from "../contract.ts";
import { fmtLocShort } from "../shell/fmt.ts";
import {
  cameraTransform,
  centreOn,
  FIT_MAX_S,
  fitCamera,
  K_MAX,
  lerpCamera,
  lodClass,
  pan,
  STAGE_K,
  stageOf,
  stepStageK,
  type Viewport,
  zoomAt,
} from "./camera.ts";
import { type FlowStep, fitText, LABEL_FONT, type PlanModel, type PlanText, renderFlow, renderPins, renderPlanSvg, roomLabels, textPx } from "./render.ts";

/** Text nodes of one room / zone whose content the label fitting rewrites (looked up once per render). */
interface RoomTexts {
  el: SVGElement;
  name: SVGTextElement | null;
  path: SVGTextElement | null;
  size: SVGTextElement | null;
  chips: SVGGElement[];
  shown: string;
}
interface ZoneTexts {
  id: string;
  name: SVGTextElement | null;
  size: SVGTextElement | null;
  shown: string;
}

const show = (el: Element | null, on: boolean) => {
  if (!el) return;
  if (on) el.removeAttribute("display");
  else el.setAttribute("display", "none");
};

export interface PlanCallbacks {
  onselect(node: string | null): void;
  onopen(node: string): void;
  onstage(stage: ZoomStage): void;
  onhover(node: string | null, rect: DOMRect | null): void;
  /** The camera settled at zoom factor k = s / s_fit (Escape zooms out while k > 1). */
  onzoom?(k: number): void;
}

const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class PlanController {
  readonly host: HTMLElement;
  model: PlanModel;
  cam: MapCamera = { x: 0, y: 0, s: 1 };
  #svg: SVGSVGElement | null = null;
  #g: SVGGElement | null = null;
  #pins: SVGGElement | null = null;
  #flows: SVGGElement | null = null;
  #flow: readonly FlowStep[] | null = null;
  #rooms = new Map<string, SVGElement>();
  #texts = new Map<string, RoomTexts>();
  #zoneTexts: ZoneTexts[] = [];
  #text: PlanText;
  #vp: Viewport = { w: 800, h: 600 };
  #sFit = 1;
  #moved = false;
  #anim = 0;
  #lodTimer: ReturnType<typeof setTimeout> | null = null;
  #stage: ZoomStage = "Z2";
  #selected: string | null = null;
  #drag: { x: number; y: number; cam: MapCamera; moved: boolean; id: number } | null = null;
  #suppressClick = false;
  #hoverTimer: ReturnType<typeof setTimeout> | null = null;
  #cb: PlanCallbacks;
  #offs: (() => void)[] = [];
  readonly allowZ3: boolean;

  constructor(host: HTMLElement, model: PlanModel, text: PlanText, descId: string, cb: PlanCallbacks, allowZ3: boolean) {
    this.host = host;
    this.model = model;
    this.#cb = cb;
    this.#text = text;
    this.allowZ3 = allowZ3;
    this.render(model, text, descId);
    this.#listen();
  }

  render(model: PlanModel, text: PlanText, descId: string): void {
    this.model = model;
    this.#text = text;
    this.host.innerHTML = renderPlanSvg(model, text, descId);
    this.#svg = this.host.querySelector("svg.plan");
    this.#g = this.host.querySelector("g.cam");
    this.#pins = this.host.querySelector("g.pins");
    this.#flows = this.host.querySelector("g.flows");
    this.#rooms.clear();
    this.#texts.clear();
    for (const el of this.host.querySelectorAll<SVGElement>(".room")) {
      const id = el.dataset.node ?? "";
      this.#rooms.set(id, el);
      this.#texts.set(id, {
        el,
        name: el.querySelector(".rn"),
        path: el.querySelector(".rp"),
        size: el.querySelector(".rs"),
        chips: [...el.querySelectorAll<SVGGElement>(".chip")],
        shown: "",
      });
    }
    this.#zoneTexts = [...this.host.querySelectorAll<SVGElement>(".zl")].map((z) => ({
      id: z.dataset.zone ?? "",
      name: z.querySelector(".zn"),
      size: z.querySelector(".zs"),
      shown: "",
    }));
    this.resize();
    if (this.#selected) this.select(this.#selected, false);
    if (this.#flow) this.setFlow(this.#flow);
  }

  /** Viewport changed (ResizeObserver): refit unless the user moved the camera. */
  resize(): void {
    const r = this.host.getBoundingClientRect();
    this.#vp = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    const fit = fitCamera(this.model.width, this.model.height, this.#vp, 24, FIT_MAX_S);
    this.#sFit = fit.s;
    if (!this.#moved) this.cam = fit;
    this.#apply(true);
  }

  get k(): number {
    return this.cam.s / this.#sFit;
  }

  #apply(lodNow: boolean): void {
    if (!this.#g || !this.#svg) return;
    this.#g.setAttribute("transform", cameraTransform(this.cam));
    this.#svg.style.setProperty("--inv-s", String(1 / this.cam.s));
    if (lodNow) this.#lod();
    else if (!this.#lodTimer) {
      this.#lodTimer = setTimeout(() => {
        this.#lodTimer = null;
        this.#lod();
      }, 100);
    }
  }

  #lod(): void {
    let anyLg = false;
    const s = this.cam.s;
    for (const r of this.model.rooms) {
      const el = this.#rooms.get(r.id);
      if (!el) continue;
      const cls = lodClass(r.w * s, r.h * s);
      if (cls === "lg") anyLg = true;
      if (el.dataset.lod !== cls) el.dataset.lod = cls;
      this.#fitRoom(r, r.w * s, r.h * s);
    }
    for (const z of this.#zoneTexts) {
      const zm = this.model.zones.find((x) => x.id === z.id);
      if (zm) this.#fitZone(z, zm.label, zm.loc, zm.w * s);
    }
    const st = stageOf(this.k, anyLg, this.allowZ3);
    if (this.#svg && this.#svg.dataset.z !== st) this.#svg.dataset.z = st;
    if (st !== this.#stage) {
      this.#stage = st;
      this.#cb.onstage(st);
    }
    this.#cb.onzoom?.(this.k);
  }

  /** Labels never clip: each part is shown whole, shortened with 「…」 or hidden for the room's on-screen size. */
  #fitRoom(r: PlanModel["rooms"][number], sw: number, sh: number): void {
    const t = this.#texts.get(r.id);
    if (!t) return;
    const L = roomLabels(r, sw, sh, this.#text.files);
    const key = `${L.name}|${L.size}|${L.path}|${L.chips}`;
    if (t.shown === key) return;
    t.shown = key;
    if (t.name) {
      if (L.name !== null && t.name.textContent !== L.name) t.name.textContent = L.name;
      show(t.name, L.name !== null);
    }
    if (t.path) {
      if (L.path !== null && t.path.textContent !== L.path) t.path.textContent = L.path;
      show(t.path, L.path !== null);
    }
    show(t.size, L.size);
    t.chips.forEach((c, i) => {
      show(c, i < L.chips);
    });
  }

  #fitZone(z: ZoneTexts, label: string, loc: number, sw: number): void {
    const sizeText = loc > 0 ? fmtLocShort(loc) : "";
    const sizeW = sizeText ? textPx(sizeText, LABEL_FONT.mono) + 16 : 0;
    const inner = sw - 20;
    const size = sizeW > 0 && textPx(label, LABEL_FONT.zone) + sizeW <= inner;
    const name = fitText(label, size ? inner - sizeW : inner, LABEL_FONT.zone);
    const key = `${name}|${size}`;
    if (z.shown === key) return;
    z.shown = key;
    if (z.name) {
      if (name !== null && z.name.textContent !== name) z.name.textContent = name;
      show(z.name, name !== null);
    }
    show(z.size, size);
  }

  /** One stage out (Escape on the map, ux.md §4.2.2); arriving at the default stage means "fit". */
  zoomOutOne(): void {
    if (stepStageK(this.k, -1, this.allowZ3) <= STAGE_K.Z2 + 1e-6) this.fit();
    else this.stepZoom(-1);
  }

  /** Animate to a camera (300 ms ease-out, log-interpolated scale; instant under reduced motion). */
  moveTo(target: MapCamera, user = true): void {
    if (user) this.#moved = true;
    cancelAnimationFrame(this.#anim);
    if (reduceMotion()) {
      this.cam = target;
      this.#apply(true);
      return;
    }
    const from = this.cam;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 300);
      this.cam = lerpCamera(from, target, t);
      this.#apply(t === 1);
      if (t < 1) this.#anim = requestAnimationFrame(step);
    };
    this.#anim = requestAnimationFrame(step);
  }

  fit(): void {
    this.#moved = false;
    this.moveTo(fitCamera(this.model.width, this.model.height, this.#vp, 24, FIT_MAX_S), false);
  }

  stepZoom(dir: 1 | -1): void {
    const k = stepStageK(this.k, dir, this.allowZ3);
    this.moveTo(zoomAt(this.cam, (k * this.#sFit) / this.cam.s, this.#vp.w / 2, this.#vp.h / 2, this.#sFit));
  }

  zoomToStage(z: ZoomStage): void {
    if (z === "Z2" && !this.#moved) {
      this.fit();
      return;
    }
    const k = STAGE_K[z];
    this.moveTo(zoomAt(this.cam, (k * this.#sFit) / this.cam.s, this.#vp.w / 2, this.#vp.h / 2, this.#sFit));
  }

  panBy(dx: number, dy: number): void {
    this.#moved = true;
    this.cam = pan(this.cam, dx, dy);
    this.#apply(false);
  }

  /** Bring a room to the centre at ≥ its current scale (dblclick target, room focus). */
  focusRoom(id: string, zoom: boolean): void {
    const r = this.model.byId.get(id);
    if (!r) return;
    const s = zoom ? Math.min(K_MAX * this.#sFit, Math.max(this.cam.s, Math.min(this.#vp.w / (r.w * 1.6), this.#vp.h / (r.h * 1.6)))) : this.cam.s;
    this.moveTo(centreOn(r, s, this.#vp));
  }

  select(id: string | null, notify = true): void {
    this.#selected = id;
    const svg = this.#svg;
    if (!svg) return;
    svg.classList.toggle("has-sel", id !== null);
    const rel = id ? (this.model.links.get(id) ?? new Set<string>()) : new Set<string>();
    for (const [rid, el] of this.#rooms) {
      el.classList.toggle("sel", rid === id);
      el.classList.toggle("rel", rel.has(rid));
    }
    for (const e of svg.querySelectorAll<SVGElement>(".edge")) e.classList.toggle("on", !!id && (e.dataset.from === id || e.dataset.to === id));
    if (notify) this.#cb.onselect(id);
  }

  /** On-screen box of a room (null when unknown). */
  roomRect(id: string): DOMRect | null {
    return this.#rooms.get(id)?.querySelector("svg")?.getBoundingClientRect() ?? null;
  }

  setClass(name: string, on: boolean): void {
    this.#svg?.classList.toggle(name, on);
  }

  /** Generation rings / ✓ by diagram node id. */
  setRoomStates(generating: ReadonlySet<string>, done: ReadonlySet<string>): void {
    for (const [id, el] of this.#rooms) {
      el.classList.toggle("gen", generating.has(id));
      el.classList.toggle("done", done.has(id) && !generating.has(id));
    }
  }

  /** §3 flow overlay (null = none): arrows + numbered tags; pins and AI frames fade to 30 %. */
  setFlow(steps: readonly FlowStep[] | null): void {
    this.#flow = steps && steps.length > 0 ? steps : null;
    if (this.#flows) this.#flows.innerHTML = this.#flow ? renderFlow(this.model, this.#flow) : "";
    this.#svg?.classList.toggle("flowing", this.#flow !== null);
  }

  setPins(counts: Readonly<Record<string, number>>): void {
    if (this.#pins) this.#pins.innerHTML = renderPins(this.model, counts);
  }

  /** Roving tabindex: the focused room becomes the single Tab stop. */
  #rove(id: string): void {
    for (const [rid, el] of this.#rooms) el.setAttribute("tabindex", rid === id ? "0" : "-1");
  }

  focusNeighbour(dir: 1 | -1): boolean {
    const active = (document.activeElement as SVGElement | null)?.closest?.(".room") as SVGElement | null;
    if (!active) return false;
    const i = this.model.rooms.findIndex((r) => r.id === active.dataset.node);
    const next = this.model.rooms[Math.max(0, Math.min(this.model.rooms.length - 1, i + dir))];
    if (!next) return false;
    const el = this.#rooms.get(next.id);
    el?.focus({ preventScroll: true });
    return true;
  }

  #roomOf(t: EventTarget | null): string | null {
    const el = (t as Element | null)?.closest?.(".room") as SVGElement | null;
    return el?.dataset.node ?? null;
  }

  #listen(): void {
    const h = this.host;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      h.addEventListener(type, fn, opts);
      this.#offs.push(() => h.removeEventListener(type, fn, opts));
    };
    on("click", (e) => {
      const id = this.#roomOf(e.target);
      if (!id) {
        const pin = (e.target as Element).closest?.(".pin") as SVGElement | null;
        if (pin?.dataset.node) return this.#cb.onopen(pin.dataset.node);
        if (!this.#suppressClick) this.select(null);
        this.#suppressClick = false;
        return;
      }
      e.preventDefault();
      if (this.#suppressClick) {
        this.#suppressClick = false;
        return;
      }
      if (this.#selected === id && e.detail <= 1) this.#cb.onopen(id);
      else if (e.detail <= 1) this.select(id);
    });
    on("dblclick", (e) => {
      const id = this.#roomOf(e.target);
      if (!id) return;
      e.preventDefault();
      this.#cb.onopen(id);
    });
    on("focusin", (e) => {
      const id = this.#roomOf(e.target);
      if (id) this.#rove(id);
    });
    on(
      "wheel",
      (e) => {
        // ⌘/Ctrl + wheel (and trackpad pinch) zooms; a sideways swipe pans; a plain vertical wheel scrolls the
        // page the map sits in (the stage is part of a scrolling page, so it never traps the wheel)
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const r = h.getBoundingClientRect();
          this.#moved = true;
          this.cam = zoomAt(this.cam, Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top, this.#sFit);
          this.#apply(false);
        } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          e.preventDefault();
          this.panBy(-e.deltaX, 0);
        }
      },
      { passive: false },
    );
    on("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.#drag = { x: e.clientX, y: e.clientY, cam: this.cam, moved: false, id: e.pointerId };
    });
    on("pointermove", (e) => {
      const d = this.#drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) {
        d.moved = true;
        h.setPointerCapture(e.pointerId);
        h.classList.add("dragging");
      }
      this.#moved = true;
      this.cam = pan(d.cam, dx, dy);
      this.#apply(false);
    });
    const end = (e: PointerEvent) => {
      const d = this.#drag;
      if (!d || d.id !== e.pointerId) return;
      if (d.moved) {
        this.#suppressClick = true;
        h.classList.remove("dragging");
        if (h.hasPointerCapture(e.pointerId)) h.releasePointerCapture(e.pointerId);
        this.#lod();
      }
      this.#drag = null;
    };
    on("pointerup", end);
    on("pointercancel", end);
    on("pointerover", (e) => {
      const id = this.#roomOf(e.target);
      if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
      if (!id) return;
      const el = this.#rooms.get(id);
      this.#hoverTimer = setTimeout(() => this.#cb.onhover(id, el?.getBoundingClientRect() ?? null), 300);
    });
    on("pointerout", (e) => {
      const to = this.#roomOf(e.relatedTarget);
      if (to) return;
      if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
      this.#hoverTimer = setTimeout(() => this.#cb.onhover(null, null), 160);
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.#anim);
    for (const off of this.#offs) off();
    this.#offs = [];
  }
}
