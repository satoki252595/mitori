/**
 * Catalog loading over the split chunks (F5; pure — the chunk imports are injected, i18n-cell.svelte.ts wires Vite's).
 * The base catalog of a language comes first; lazy namespaces are merged on demand (`ensure`) and follow every
 * language switch (`switchTo`). `t()` reads the merged catalog the setter installs.
 */
import type { UiLang } from "@mitori/core";
import type { LazyNs } from "./i18n-ns.ts";

export type Cat = Readonly<Record<string, string>>;
export type Part = "base" | LazyNs;

export interface CatalogLoader {
  /** The base catalog of `lang` (cached). */
  base(lang: UiLang): Promise<Cat>;
  /** Merge `ns` into the active language's catalog (and remember it for later switches). */
  ensure(ns: LazyNs): Promise<void>;
  /** Load base + every namespace asked for so far in `lang`, then install the merged catalog. */
  switchTo(lang: UiLang): Promise<void>;
  /** Namespaces asked for so far. */
  wanted(): readonly LazyNs[];
}

export function makeCatalogLoader(
  load: (lang: UiLang, part: Part) => Promise<Cat>,
  install: (lang: UiLang, cat: Cat) => void,
  current: () => UiLang,
): CatalogLoader {
  const wanted = new Set<LazyNs>();
  const parts = new Map<UiLang, Map<Part, Cat>>();
  const inflight = new Map<string, Promise<Cat>>();
  const of = (lang: UiLang) => {
    let m = parts.get(lang);
    if (!m) {
      m = new Map();
      parts.set(lang, m);
    }
    return m;
  };
  const part = (lang: UiLang, p: Part): Promise<Cat> => {
    const have = of(lang).get(p);
    if (have) return Promise.resolve(have);
    const key = `${lang}:${p}`;
    let f = inflight.get(key);
    if (!f) {
      f = load(lang, p).then(
        (cat) => {
          of(lang).set(p, cat);
          inflight.delete(key);
          return cat;
        },
        (e: unknown) => {
          inflight.delete(key);
          throw e;
        },
      );
      inflight.set(key, f);
    }
    return f;
  };
  // base first, then the namespaces in a stable order (a later part never loses to an earlier one)
  const merged = (lang: UiLang): Cat => {
    const m = of(lang);
    const out: Record<string, string> = { ...(m.get("base") ?? {}) };
    for (const [p, cat] of m) if (p !== "base") Object.assign(out, cat);
    return out;
  };
  return {
    base: (lang) => part(lang, "base"),
    async ensure(ns) {
      wanted.add(ns);
      const lang = current();
      if (of(lang).has(ns)) return;
      await part(lang, ns);
      // the language may have switched meanwhile: that switch brings `wanted` along itself
      if (current() === lang) install(lang, merged(lang));
    },
    async switchTo(lang) {
      await part(lang, "base");
      for (;;) {
        const missing = [...wanted].filter((ns) => !of(lang).has(ns));
        if (missing.length === 0) break;
        await Promise.all(missing.map((ns) => part(lang, ns)));
      }
      install(lang, merged(lang));
    },
    wanted: () => [...wanted],
  };
}
