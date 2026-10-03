// Page-side collectors (testing spec §6.4, §6.6): Event Timing for INP, layout-shift for CLS, long tasks. Installed with
// `addInitScript` when the page is opened through the daemon harness, or lazily by the first `ui.*` call — the observers
// are `buffered`, so entries from before a lazy install are still delivered.

/** Source of the collector. Idempotent per document (`window.__mitoriPerf`). */
export const OBSERVERS_SOURCE = `(() => {
  if (window.__mitoriPerf) return;
  const p = { events: [], cls: 0, longtasks: [] };
  window.__mitoriPerf = p;
  const watch = (type, init, on) => {
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) on(e); }).observe({ type, buffered: true, ...init });
    } catch (_) { /* entry type unsupported in this browser */ }
  };
  watch("event", { durationThreshold: 16 }, (e) => {
    if (e.interactionId > 0) p.events.push({ interactionId: e.interactionId, name: e.name, duration: e.duration, startTime: e.startTime });
  });
  watch("layout-shift", {}, (e) => { if (!e.hadRecentInput) p.cls += e.value; });
  watch("longtask", {}, (e) => { p.longtasks.push({ startTime: e.startTime, duration: e.duration }); });
})()`;

export interface RawInteraction {
  interactionId: number;
  name: string;
  duration: number;
  startTime: number;
}
