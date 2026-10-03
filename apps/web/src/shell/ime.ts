/**
 * IME guard (ux.md §8.6, contract `isComposing`). Rule (3): Safari delivers `compositionend` BEFORE the keydown
 * that committed the conversion, so every keydown in the same task as a `compositionend` is swallowed. One
 * capture listener sets a flag that a `setTimeout(0)` clears (= end of the task).
 */

let justComposed = false;
let installed = false;

/** Record a `compositionend` (also used by unit tests to simulate Safari's event order). */
export function noteCompositionEnd(): void {
  justComposed = true;
  setTimeout(() => {
    justComposed = false;
  }, 0);
}

/** Install the one capture listener (idempotent; done at import in the browser). */
export function installCompositionTracker(target: Pick<EventTarget, "addEventListener">): void {
  if (installed) return;
  installed = true;
  target.addEventListener("compositionend", noteCompositionEnd, { capture: true });
}

if (typeof window !== "undefined") installCompositionTracker(window);

export function isComposingImpl(e: Pick<KeyboardEvent, "isComposing" | "keyCode" | "key">): boolean {
  if (e.isComposing) return true;
  if (e.keyCode === 229 || e.key === "Process") return true;
  return justComposed;
}

/** keyCode 229 specifically (the hint toast is shown only for this case, ux.md §8.1 step 1). */
export function isImeProcessKey(e: Pick<KeyboardEvent, "keyCode" | "key">): boolean {
  return e.keyCode === 229 || e.key === "Process";
}
