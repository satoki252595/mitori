/**
 * NC-01: focus the Composer's textarea once it can take focus. A margin Composer mounts inside a `.slot.hidden`
 * (`visibility: hidden` until Margin has measured and placed it), and `focus()` on an invisible element is a no-op:
 * the typed question went nowhere and its letters fired single-key shortcuts (`y` `h` `t` `f`). Retry once per frame
 * until the element is visible, at most `maxFrames`; never steal focus that the reader has since put elsewhere.
 */
export interface FocusDeps {
  raf(fn: () => void): unknown;
  visible(el: HTMLElement): boolean;
  /** The element that has focus now (document.activeElement). */
  active(): Element | null;
}

const browserDeps = (): FocusDeps => ({
  raf: (fn) => requestAnimationFrame(fn),
  visible: (el) => el.isConnected && getComputedStyle(el).visibility === "visible" && el.getClientRects().length > 0,
  active: () => document.activeElement,
});

/** True when focus is on something the reader chose that is not the page / a block (another input, a button). */
function focusTaken(a: Element | null, el: HTMLElement): boolean {
  if (!a || a === el) return false;
  const tag = a.tagName;
  if (tag === "BODY" || tag === "HTML") return false;
  if ((a as HTMLElement).classList?.contains("blk")) return false;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a as HTMLElement).isContentEditable === true;
}

/** Resolves true when focus landed, false when it gave up (never visible / focus taken elsewhere). */
export function focusWhenShown(el: HTMLElement | undefined | null, maxFrames = 30, deps: FocusDeps = browserDeps()): Promise<boolean> {
  return new Promise((resolve) => {
    if (!el) return resolve(false);
    let n = 0;
    const attempt = () => {
      if (focusTaken(deps.active(), el)) return resolve(false);
      if (deps.visible(el)) {
        el.focus({ preventScroll: true });
        if (deps.active() === el) return resolve(true);
      }
      if (++n > maxFrames) return resolve(false);
      deps.raf(attempt);
    };
    attempt();
  });
}
