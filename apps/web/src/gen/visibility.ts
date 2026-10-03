/**
 * Visible-time clock of the data-disclosure row (UXP-04, AC-U-DP): only a click after the row was in view (≥ 90 %)
 * for ≥ 1 s in total counts as the acknowledgement. Fed by IntersectionObserver entries; pure (time injected).
 */
export class VisibleClock {
  #since: number | null = null;
  #total = 0;
  /** ISO time the row first became visible (recorded with the ack). */
  shownAt: string | null = null;

  /** One observer entry. Threshold crossings while already visible (ratio 1 → 0.95) keep the running interval. */
  entry(visible: boolean, now: number, iso: () => string): void {
    if (visible) {
      if (this.shownAt === null) this.shownAt = iso();
      if (this.#since === null) this.#since = now;
    } else if (this.#since !== null) {
      this.#total += now - this.#since;
      this.#since = null;
    }
  }

  /** Total visible milliseconds up to `now`. */
  visibleMs(now: number): number {
    return this.#total + (this.#since === null ? 0 : now - this.#since);
  }
}
