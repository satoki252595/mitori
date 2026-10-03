// The export document (gen spec §10.10 R1, ADR-0008 R1 [SEC-11]): ONE html file, viewer JS + CSS + the payload inline.
// Safety rests on three things: the meta CSP (no network at all, scripts only by hash, images only `data:`), the JSON
// escaping that makes `</script>` / `<!--` inside any string impossible, and the viewer script checked to be
// embeddable. Pure: no clock, no I/O.
import { MitoriError } from "@mitori/core";
import { hexToBase64, sha256Hex, utf8 } from "./sha256.ts";

const escAttr = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * JSON for a `<script type="application/json">`: `< > &` U+2028 U+2029 become `\uXXXX` (still valid JSON, identical
 * after `JSON.parse`), so the text can never contain `</script`, `<!--` or a line terminator that ends a script.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The CSP of an export (verbatim from the spec; only the script hash varies). */
export function exportCsp(jsSha256Hex: string): string {
  return `default-src 'none'; script-src 'sha256-${hexToBase64(jsSha256Hex)}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;
}

/** Throws when the viewer bundle cannot be embedded safely (or does not match the hash the CSP will carry). */
export function checkViewerAssets(a: { js: string; css: string; jsSha256: string }): void {
  if (a.js === "")
    throw new MitoriError("E_INTERNAL", "the viewer bundle is not built (run `bun run build:bin`, or scripts/gen-assets.ts, to embed it)", {
      params: { reason: "viewer_missing" },
    });
  // an inline script ends at the first `</script` (any case) and `<!--` changes the script data state
  if (/<\/script|<!--/i.test(a.js))
    throw new MitoriError("E_INTERNAL", "the viewer bundle contains `</script` or `<!--` and cannot be inlined", { params: { reason: "viewer_unsafe" } });
  if (/<\/style/i.test(a.css)) throw new MitoriError("E_INTERNAL", "the viewer stylesheet contains `</style`", { params: { reason: "viewer_unsafe" } });
  if (sha256Hex(utf8(a.js)) !== a.jsSha256)
    throw new MitoriError("E_INTERNAL", "the viewer bundle does not match its hash (stale embedded asset)", { params: { reason: "viewer_hash" } });
}

const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1.5' y='1.5' width='13' height='13' rx='2' fill='none' stroke='%231C1B19' stroke-width='1.6'/%3E%3Cpath d='M1.5 8h6V1.5M7.5 8v6.5' fill='none' stroke='%231C1B19' stroke-width='1.2'/%3E%3C/svg%3E";

export interface PageParts {
  title: string;
  lang: "ja" | "en";
  level: "newcomer" | "standard" | "expert";
  css: string;
  js: string;
  jsSha256: string;
  /** Already `jsonForScript`-escaped. */
  json: string;
}

/** The document. The viewer script is inlined byte for byte (its hash is in the CSP), after the data. */
export function renderPage(p: PageParts): string {
  const noscript = p.lang === "ja" ? "このファイルの表示には JavaScript が必要です。" : "This file needs JavaScript to display.";
  return (
    `<!doctype html>\n<html lang="${p.lang}" data-level="${p.level}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta http-equiv="Content-Security-Policy" content="${escAttr(exportCsp(p.jsSha256))}">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n` +
    `<meta name="referrer" content="no-referrer">\n<meta name="generator" content="mitori export">\n` +
    `<title>${escAttr(p.title)}</title>\n<link rel="icon" href="${ICON}">\n<style>${p.css}</style>\n</head>\n<body>\n` +
    `<div id="app"></div>\n<noscript><p style="padding:24px;font:14px/1.6 system-ui,sans-serif">${noscript}</p></noscript>\n` +
    `<script type="application/json" id="mitori-export">${p.json}</script>\n<script>${p.js}</script>\n</body>\n</html>\n`
  );
}
