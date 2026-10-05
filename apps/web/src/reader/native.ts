/** First-paint Reader behaviour over canonical SSR markup; no Svelte, stores, Markdown or arbitrary HTML. */
import type { BlockId, BlockView, GlossaryId, ReaderLevel, SectionId, ThreadIntent, WorkspaceKey } from "@mitori/core";
import { reservePx } from "../gen/state.ts";
import { markAfterPaint } from "../shell/perf.ts";
import { anchorFromRange, rangeOf } from "../threads/dom-anchor.ts";
import { applyLevel, type DecorateText, decorateBlock } from "./decorate.ts";
import { blockVisibleImpl, stepLevel } from "./levels.ts";
import type { NativeReaderState } from "./native-state.ts";
import { type PageModel, stepBlock } from "./page.ts";
import { captureAnchor, restoreAnchor } from "./scroll-anchor.ts";
import { sum, visibleWindows, type WindowRange } from "./virtual.ts";

export type NativeReaderAction =
  | { kind: "compose"; intent: ThreadIntent; block: BlockId | null; claim: string | null; trigger?: number }
  | { kind: "selection" }
  | { kind: "cite"; cite: string; blob: string; block: BlockId | null; via: "hover" | "focus" | "click" }
  | { kind: "pin"; cite: string; blob: string; block: BlockId | null }
  | { kind: "term"; term: GlossaryId; block: BlockId | null; via: "hover" | "focus" | "click" }
  | { kind: "claim"; block: BlockId; claim: string | null }
  | { kind: "gutter"; block: BlockId }
  | { kind: "placeholder"; section: SectionId };

export interface NativeReaderOptions {
  root: HTMLElement;
  page: PageModel;
  /** Includes title blocks which buildPage omits from the prose body. Objects are the snapshot's DTOs. */
  sourceBlocks?: readonly BlockView[];
  ws: WorkspaceKey;
  level: ReaderLevel;
  lang?: "ja" | "en";
  placeholderLabel?: string;
  block?: BlockId;
  initial?: NativeReaderState;
  text: DecorateText;
  /** The owner checks its navigation epoch before loading / replaying full editor actions. */
  enhance(action: NativeReaderAction, state: NativeReaderState): void;
  /** Paging requests the missing block's canonical SSR HTML; it never runs a model. */
  refresh?(block: BlockId, state: NativeReaderState): void;
  replaceBlock?(block: BlockId): void;
  navigate?(section: SectionId): void;
  pages?: readonly SectionId[];
  cancelEnhance?(via: "hover" | "focus"): void;
  setLevel?(level: ReaderLevel): void;
  read?(section: SectionId): void;
}

/** Restore normalized offsets only when their quote still matches the current server text. */
export function restoreNativeSelection(root: ParentNode, selection: NativeReaderState["selection"]): Range | null {
  if (!selection) return null;
  const mb = root.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(selection.block)}"] .mb`);
  const range = mb ? rangeOf(mb, selection.start, selection.end) : null;
  const next = range ? anchorFromRange(range) : null;
  const quote = selection.anchor.doc?.quote;
  if (
    !range ||
    !next ||
    !quote ||
    next.anchor.doc?.quote?.exact !== quote.exact ||
    next.anchor.doc.quote.prefix !== quote.prefix ||
    next.anchor.doc.quote.suffix !== quote.suffix
  )
    return null;
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return range;
}

export function mountNativeReader(o: NativeReaderOptions) {
  const { root, page } = o;
  const host = root.querySelector<HTMLElement>(".reader-root");
  let alive = true;
  const initial = o.initial?.page === page.page && o.initial.ws === o.ws ? o.initial : undefined;
  let focused = initial?.focused ?? o.block ?? null;
  const forced = new Set(initial?.forced ?? []);
  const partials = new Map<SectionId, { section: SectionId; text: string; reservedPx: number }>();
  if (o.block) forced.add(o.block);
  let level = o.level;
  let range: WindowRange = initial?.window ?? { first: Number(host?.dataset.windowFirst ?? 0), last: Number(host?.dataset.windowLast ?? 2) };
  const heights: number[] = (() => {
    try {
      const a: unknown = JSON.parse(host?.dataset.readerHeights ?? "[]");
      return Array.isArray(a) && a.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) ? a : [];
    } catch {
      return [];
    }
  })();
  const source = [...(o.sourceBlocks ?? []), ...page.parts.flatMap((p) => p.blocks)];
  const blocks = new Map(source.map((b) => [b.id, b]));
  const aliases = new Map<BlockId, Set<BlockView>>();
  for (const b of source) {
    const group = aliases.get(b.id) ?? new Set<BlockView>();
    group.add(b);
    aliases.set(b.id, group);
  }
  const wrappers = new Map<BlockId, HTMLElement>();
  const remember = (inRoot: ParentNode) => {
    for (const el of inRoot.querySelectorAll<HTMLElement>(".blk[data-b]")) wrappers.set(el.dataset.b as BlockId, el);
  };
  remember(root);
  for (const template of root.querySelectorAll<HTMLTemplateElement>("template[data-reader-window]")) remember(template.content);
  const decorated = new WeakSet<HTMLElement>();
  let raf = 0;
  let hover: ReturnType<typeof setTimeout> | null = null;
  const readIo =
    o.read && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) if (alive && e.isIntersecting) o.read?.((e.target as HTMLElement).dataset.read as SectionId);
          },
          { rootMargin: "0px 0px -20% 0px" },
        )
      : null;

  function blockEl(id: BlockId) {
    return root.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(id)}"]`);
  }
  function decorate() {
    for (const el of root.querySelectorAll<HTMLElement>(".blk[data-b]")) {
      const b = blocks.get(el.dataset.b as BlockId);
      if (b && !decorated.has(el)) {
        decorateBlock(el, b, level, o.text);
        decorated.add(el);
      }
      el.classList.toggle("focus", focused === el.dataset.b);
      el.classList.toggle("force", forced.has(el.dataset.b as BlockId));
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-read]")) {
      const part = page.parts.find((p) => p.node.id === el.dataset.read);
      if (part && part.blocks.every((b) => b.html !== "")) readIo?.observe(el);
    }
  }
  function spacers() {
    const lead = host?.querySelector<HTMLElement>('[data-reader-spacer="lead"]');
    const tail = host?.querySelector<HTMLElement>('[data-reader-spacer="tail"]');
    if (lead) lead.style.height = `${sum(heights, 0, range.first)}px`;
    if (tail) tail.style.height = `${sum(heights, range.last + 1, heights.length)}px`;
  }
  function mountWindows(next: WindowRange) {
    if (!host || !heights.length) return;
    const anchor = captureAnchor(root);
    for (const win of host.querySelectorAll<HTMLElement>(":scope > .bwin[data-window]")) {
      const i = Number(win.dataset.window);
      if (i >= next.first && i <= next.last) continue;
      let template = host.querySelector<HTMLTemplateElement>(`template[data-reader-window="${i}"]`);
      if (!template) {
        template = document.createElement("template");
        template.dataset.readerWindow = String(i);
        host.append(template);
      }
      for (const mark of win.querySelectorAll("[data-read]")) readIo?.unobserve(mark);
      template.content.append(...win.childNodes);
      win.remove();
    }
    const tail = host.querySelector('[data-reader-spacer="tail"]');
    for (let i = next.first; i <= next.last; i++) {
      let win = host.querySelector<HTMLElement>(`:scope > .bwin[data-window="${i}"]`);
      if (!win) {
        const template = host.querySelector<HTMLTemplateElement>(`template[data-reader-window="${i}"]`);
        if (!template) continue;
        win = document.createElement("div");
        win.className = "bwin";
        win.dataset.window = String(i);
        win.append(template.content);
        host.insertBefore(win, tail);
      }
    }
    const mounted = [...host.querySelectorAll<HTMLElement>(":scope > .bwin[data-window]")].sort((a, b) => Number(a.dataset.window) - Number(b.dataset.window));
    for (const win of mounted) {
      host.insertBefore(win, tail);
      if (win.offsetHeight > 0) heights[Number(win.dataset.window)] = win.offsetHeight;
    }
    range = next;
    spacers();
    decorate();
    restoreAnchor(root, anchor, page.order);
  }
  function ensureMounted(id: BlockId) {
    if (!host || blockEl(id)) return;
    const template = [...host.querySelectorAll<HTMLTemplateElement>("template[data-reader-window]")].find((t) =>
      t.content.querySelector(`.blk[data-b="${CSS.escape(id)}"]`),
    );
    if (template) {
      const at = Number(template.dataset.readerWindow);
      mountWindows({ first: Math.max(0, at - 1), last: Math.min(heights.length - 1, at + 1) });
    }
  }
  function selection(): NativeReaderState["selection"] {
    const sel = document.getSelection();
    const r = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const a = r && root.contains(r.startContainer) ? anchorFromRange(r) : null;
    return a ? { block: a.block, start: a.start, end: a.end, anchor: a.anchor } : null;
  }
  function capture(): NativeReaderState {
    return {
      page: page.page,
      ws: o.ws,
      focused,
      forced: [...forced],
      scrollY: window.scrollY,
      anchor: captureAnchor(root),
      ...(heights.length ? { window: { ...range } } : {}),
      selection: selection(),
      partials: [...partials.values()].filter((p) => p.text !== ""),
      reservations: [...root.querySelectorAll<HTMLElement>(".sec-body.mstream[data-section]")].flatMap((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight ? [{ section: el.dataset.section as SectionId, height: r.height }] : [];
      }),
    };
  }
  function enhance(action: NativeReaderAction) {
    if (alive) o.enhance(action, capture());
  }
  function partial(section: SectionId, text: string, previousReserve = 0): boolean {
    if (!alive) return false;
    const part = page.parts.find((p) => p.node.id === section);
    if (!part) return false;
    const body = root.querySelector<HTMLElement>(`.sec-body[data-section="${CSS.escape(section)}"]`);
    const markerSelector = `[data-reader-partial="${CSS.escape(section)}"]`;
    const marker =
      root.querySelector<HTMLElement>(markerSelector) ??
      [...root.querySelectorAll<HTMLTemplateElement>("template[data-reader-window]")]
        .map((t) => t.content.querySelector<HTMLElement>(markerSelector))
        .find(Boolean);
    if (!body && !marker) return false;
    const anchor = captureAnchor(root);
    const prior = partials.get(section);
    const heldReserve = Number.parseFloat(body?.style.getPropertyValue("--reserve") ?? "0");
    const reservedPx = Math.max(
      prior?.reservedPx ?? 0,
      previousReserve,
      Number.isFinite(heldReserve) ? heldReserve : 0,
      reservePx(part.node.est?.outTokens, o.lang ?? "ja"),
    );
    partials.set(section, { section, text, reservedPx });
    const selector = `p.partial[data-section="${CSS.escape(section)}"]`;
    let p = body?.querySelector<HTMLParagraphElement>(selector) ?? marker?.parentNode?.querySelector<HTMLParagraphElement>(selector);
    if (text === "") p?.remove();
    else {
      if (!p) {
        p = document.createElement("p");
        p.className = "partial";
        p.dataset.section = section;
        if (marker) marker.before(p);
        else body?.append(p);
      }
      p.textContent = text;
      const caret = document.createElement("span");
      caret.className = "caret";
      caret.setAttribute("aria-hidden", "true");
      p.append(caret);
      if (body) {
        body.classList.add("mstream");
        body.style.setProperty("--reserve", `${reservedPx}px`);
        delete body.dataset.nativeHeld;
      }
    }
    restoreAnchor(root, anchor, page.order);
    onScroll();
    return true;
  }
  function focus(id: BlockId, scroll: boolean) {
    if (!blocks.has(id)) return;
    ensureMounted(id);
    focused = id;
    decorate();
    const el = blockEl(id);
    el?.focus({ preventScroll: true });
    if (scroll) el?.scrollIntoView({ block: "nearest" });
    o.replaceBlock?.(id);
    if (blocks.get(id)?.html === "") o.refresh?.(id, capture());
  }
  function setLevel(next: ReaderLevel) {
    const a = captureAnchor(root);
    level = next;
    document.documentElement.dataset.level = next;
    applyLevel(root, next);
    restoreAnchor(root, a, page.order);
    o.setLevel?.(next);
    markAfterPaint("mitori:level:applied", { level: next });
  }
  function action(id: string, e?: KeyboardEvent): boolean {
    if (!alive) return false;
    if (id === "read.next" || id === "read.prev") {
      const b = stepBlock(page.order, focused, id === "read.next" ? 1 : -1, (b) => forced.has(b) || blockVisibleImpl(blocks.get(b)!, level) !== "hidden");
      if (b) focus(b, true);
      return true;
    }
    if (id === "level.down" || id === "level.up" || id === "level.reset") {
      setLevel(stepLevel(level, id === "level.down" ? -1 : id === "level.up" ? 1 : 0));
      return true;
    }
    if (id === "read.chapter" && e) {
      const n = Number(/^Digit(\d)$|^Numpad(\d)$/.exec(e.code)?.slice(1).find(Boolean) ?? e.key);
      const next = o.pages?.filter((p) => !p.includes("/"))[n - 1];
      if (next) o.navigate?.(next);
      return true;
    }
    if (id === "peek.pin") {
      const a = (document.activeElement as Element | null)?.closest<HTMLElement>("a.mcite,a.fcite");
      if (!a || !root.contains(a)) return false;
      enhance({
        kind: "pin",
        cite: a.dataset.cite ?? "",
        blob: a.dataset.blob ?? "",
        block: (a.closest<HTMLElement>(".blk[data-b]")?.dataset.b as BlockId) ?? null,
      });
      return true;
    }
    if (["act.comment", "act.explain", "act.fix"].includes(id)) {
      const selected = selection();
      if (!selected && !focused) return false;
      enhance({
        kind: "compose",
        intent: id === "act.comment" ? "note" : id === "act.explain" ? "question" : "change",
        block: selected?.block ?? focused,
        claim: null,
        ...(e ? { trigger: e.timeStamp } : {}),
      });
      return true;
    }
    return false;
  }
  const cite = (a: HTMLElement, via: "hover" | "focus" | "click") =>
    enhance({
      kind: "cite",
      cite: a.dataset.cite ?? "",
      blob: a.dataset.blob ?? "",
      block: (a.closest<HTMLElement>(".blk[data-b]")?.dataset.b as BlockId) ?? null,
      via,
    });
  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element)?.closest<HTMLElement>("button,a,abbr.mterm,.mc[data-claim]");
    if (!el || !root.contains(el) || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const more = el.closest<HTMLElement>(".more-chip[data-ids]");
    if (more) {
      for (const id of (more.dataset.ids ?? "").split(","))
        if (blocks.has(id as BlockId)) {
          forced.add(id as BlockId);
          ensureMounted(id as BlockId);
        }
      decorate();
      e.preventDefault();
      return;
    }
    if (el.matches("a.mcite,a.fcite")) {
      e.preventDefault();
      cite(el, "click");
    } else if (el.dataset.term) {
      e.preventDefault();
      enhance({
        kind: "term",
        term: el.dataset.term as GlossaryId,
        block: (el.closest<HTMLElement>(".blk[data-b]")?.dataset.b as BlockId) ?? null,
        via: "click",
      });
    } else if (el.dataset.ph) {
      e.preventDefault();
      enhance({ kind: "placeholder", section: el.dataset.ph as SectionId });
    } else if (el.matches(".mc[data-verdict='inferred'],.mc[data-verdict='unsupported'],.mc[data-verdict='stale'],button.vsum")) {
      const b = el.closest<HTMLElement>(".blk[data-b]")?.dataset.b as BlockId | undefined;
      if (b) {
        e.preventDefault();
        enhance({ kind: "claim", block: b, claim: el.dataset.claim ?? null });
      }
    } else if (el.matches(".cite-end")) {
      const first = el.closest(".mb")?.querySelector<HTMLElement>("a.mcite");
      if (first) {
        e.preventDefault();
        cite(first, "click");
      }
    }
  };
  const onOver = (e: PointerEvent) => {
    if (e.buttons) return;
    const a = (e.target as Element)?.closest<HTMLElement>("a.mcite,a.fcite");
    const term = (e.target as Element)?.closest<HTMLElement>("abbr.mterm");
    const b = (e.target as Element)?.closest<HTMLElement>(".blk[data-b]");
    const target = a ?? term ?? b;
    if (!target || target.contains(e.relatedTarget as Node | null)) return;
    if (hover) clearTimeout(hover);
    hover = setTimeout(() => {
      if (!alive || !target.isConnected) return;
      if (a) cite(a, "hover");
      else if (term) enhance({ kind: "term", term: term.dataset.term as GlossaryId, block: (b?.dataset.b as BlockId) ?? null, via: "hover" });
      else if (b) enhance({ kind: "gutter", block: b.dataset.b as BlockId });
    }, 120);
  };
  const onOut = (e: PointerEvent) => {
    const target = (e.target as Element)?.closest<HTMLElement>("a.mcite,a.fcite,abbr.mterm,.blk[data-b]");
    if (target?.contains(e.relatedTarget as Node | null)) return;
    if (hover) clearTimeout(hover);
    o.cancelEnhance?.("hover");
  };
  const onFocus = (e: FocusEvent) => {
    const el = (e.target as Element)?.closest<HTMLElement>(".blk[data-b]");
    if (el) {
      focused = el.dataset.b as BlockId;
      decorate();
    }
    const a = (e.target as Element)?.closest<HTMLElement>("a.mcite,a.fcite");
    if (a?.matches(":focus-visible")) cite(a, "focus");
    const term = (e.target as Element)?.closest<HTMLElement>("abbr.mterm");
    if (term) enhance({ kind: "term", term: term.dataset.term as GlossaryId, block: (el?.dataset.b as BlockId) ?? null, via: "focus" });
  };
  const onFocusOut = (e: FocusEvent) => {
    const el = (e.target as Element)?.closest<HTMLElement>("a.mcite,a.fcite,abbr.mterm");
    if (!el || el.contains(e.relatedTarget as Node | null) || (e.relatedTarget as Element | null)?.closest(".pop.peek,.pop.termcard")) return;
    o.cancelEnhance?.("focus");
  };
  const onDown = () => {
    if (hover) clearTimeout(hover);
    o.cancelEnhance?.("hover");
  };
  const onSelection = () => {
    if (selection()) enhance({ kind: "selection" });
  };
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!alive) return;
      releaseHeld();
      if (!host || !heights.length) return;
      const anchor = captureAnchor(root);
      for (const win of host.querySelectorAll<HTMLElement>(":scope > .bwin[data-window]"))
        if (win.offsetHeight > 0) heights[Number(win.dataset.window)] = win.offsetHeight;
      spacers();
      restoreAnchor(root, anchor, page.order);
      const top = host.getBoundingClientRect().top + window.scrollY;
      const next = visibleWindows(heights, top, window.scrollY, window.scrollY + window.innerHeight);
      if (next.first !== range.first || next.last !== range.last) mountWindows(next);
    });
  };
  const releaseHeld = () => {
    const anchor = captureAnchor(root);
    for (const el of root.querySelectorAll<HTMLElement>("[data-native-held]")) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) {
        el.classList.remove("mstream");
        el.style.removeProperty("--reserve");
        delete el.dataset.nativeHeld;
      }
    }
    restoreAnchor(root, anchor, page.order);
  };
  root.addEventListener("click", onClick);
  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerout", onOut);
  root.addEventListener("focusin", onFocus);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("pointerup", onSelection);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("toggle", onScroll, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  decorate();
  if (initial) {
    mountWindows(range);
    if (focused) focus(focused, false);
    for (const reservation of initial.reservations ?? []) {
      const el = root.querySelector<HTMLElement>(`.sec-body[data-section="${CSS.escape(reservation.section)}"]`);
      if (el && !el.classList.contains("mstream") && Number.isFinite(reservation.height) && reservation.height > 0) {
        el.classList.add("mstream");
        el.style.setProperty("--reserve", `${reservation.height}px`);
        el.dataset.nativeHeld = "";
      }
    }
    window.scrollTo(0, initial.scrollY);
    restoreAnchor(root, initial.anchor, page.order);
    restoreNativeSelection(root, initial.selection);
    for (const p of initial.partials ?? []) {
      const state = page.parts.find((part) => part.node.id === p.section)?.node.state;
      if (state !== "generated" && state !== "static_only") partial(p.section, p.text, p.reservedPx);
    }
  } else if (focused) focus(focused, true);
  return {
    capture,
    action,
    ensureMounted,
    partial,
    /** Only canonical server HTML for an existing unchanged block; metadata/SSE changes require a fresh SSR view. */
    fill(next: readonly BlockView[]): boolean {
      if (
        !alive ||
        next.some((b) => {
          const old = blocks.get(b.id);
          return !old || old.hash !== b.hash || old.section !== b.section;
        })
      )
        return false;
      const anchor = captureAnchor(root);
      for (const b of next) {
        const old = blocks.get(b.id)!;
        if (old.html !== "" || b.html === "") continue;
        for (const alias of aliases.get(b.id) ?? [])
          if (alias.hash === b.hash && alias.html === "") Object.assign(alias, { html: b.html, mdLine: b.mdLine, htmlLang: b.htmlLang });
        const el = wrappers.get(b.id);
        if (!el) continue; // A title block is drawn by the canonical section head.
        el.removeAttribute("aria-busy");
        el.style.removeProperty("min-height");
        el.dataset.origin = old.origin;
        el.dataset.ln = String(old.mdLine);
        el.classList.toggle("thread", old.threads.open > 0);
        // b.html comes only from the authenticated, sanitized section DTO, the same boundary as BlockHost {@html}.
        if (old.status === "placeholder") {
          el.classList.add("ph-wrap");
          const ph = document.createElement("div");
          ph.className = "ph";
          const prose = document.createElement("div");
          prose.innerHTML = old.html;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn btn-sec btn-s";
          button.dataset.ph = old.section;
          button.textContent = o.placeholderLabel ?? "Generate";
          ph.append(prose, button);
          el.replaceChildren(ph);
        } else el.innerHTML = old.html;
        decorated.delete(el);
        decorateBlock(el, old, level, o.text);
        decorated.add(el);
      }
      decorate();
      restoreAnchor(root, anchor, page.order);
      onScroll();
      return true;
    },
    jump(id: BlockId) {
      if (blocks.has(id)) {
        forced.add(id);
        focus(id, true);
      }
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      if (hover) clearTimeout(hover);
      readIo?.disconnect();
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerout", onOut);
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("pointerup", onSelection);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("toggle", onScroll, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    },
  };
}
