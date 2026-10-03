// The assets a cold load of the shell requests, read off its HTML (testing spec §6.5 step 1):
// `<script type="module" src>`, `<link rel="modulepreload">`, `<link rel="stylesheet">` and font preloads.
export interface ShellAssets {
  /** Entry module scripts, in document order. */
  scripts: string[];
  /** `modulepreload` hints — fetched before the page paints, so they count towards the initial JS. */
  preloads: string[];
  styles: string[];
  fonts: string[];
  /** References to other origins (the shell must be self-contained; reported, never measured). */
  external: string[];
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
};

/** Absolute path of a reference on the shell's own origin, without query or fragment; null for other origins. */
function local(ref: string): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref) || /^(?:data|blob|javascript):/i.test(ref)) return null;
  const path = ref.split(/[?#]/)[0] as string;
  return path.startsWith("/") ? path : `/${path.replace(/^\.\//, "")}`;
}

export function extractAssets(html: string): ShellAssets {
  const out: ShellAssets = { scripts: [], preloads: [], styles: [], fonts: [], external: [] };
  const add = (list: string[], ref: string | null) => {
    if (!ref) return;
    const p = local(ref);
    if (p === null) out.external.push(ref);
    else if (!list.includes(p)) list.push(p);
  };
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    if (/^module$/i.test(attr(tag, "type") ?? "")) add(out.scripts, attr(tag, "src"));
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rels = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(tag, "href");
    if (rels.includes("modulepreload")) add(out.preloads, href);
    else if (rels.includes("stylesheet")) add(out.styles, href);
    else if (rels.includes("preload") && (attr(tag, "as") ?? "").toLowerCase() === "font") add(out.fonts, href);
  }
  return out;
}
