// Kind wrappers of §10.2 (GitHub alerts, question bullets) and the ID-comment placement. Unwrapping is
// exact-or-nothing: `unwrap(kind, raw)` succeeds only when `wrap(kind, md)` reproduces `raw` byte for byte, so a
// load → save of a canonical file never changes bytes and a non-canonical block keeps its text verbatim.
import type { BlockId, BlockKind, DocLang } from "@mitori/core";
import { BLOCK_ID_PLACEMENT, CALLOUT_FORMAT } from "../contract.ts";
import { codeLines } from "./blocks.ts";

type CalloutKind = keyof typeof CALLOUT_FORMAT;

/** Kinds rendered as a GitHub alert. */
export const CALLOUT_KINDS = Object.keys(CALLOUT_FORMAT) as CalloutKind[];

const isCallout = (k: BlockKind): k is CalloutKind => k in CALLOUT_FORMAT;

function alertHead(kind: CalloutKind, lang: DocLang): string[] {
  const f = CALLOUT_FORMAT[kind];
  const head = [`> [!${f.alert}]`];
  if (f.label) head.push(`> **${f.label[lang]}**`);
  return head;
}

/** Wrap a block's md (file form, no ID comment) in its kind's outer syntax. */
export function wrapKind(kind: BlockKind, md: string, lang: DocLang): string {
  if (isCallout(kind)) {
    const lines = md === "" ? [] : md.split("\n").map((l) => (l === "" ? ">" : `> ${l}`));
    return [...alertHead(kind, lang), ...lines].join("\n");
  }
  if (kind === "question") {
    return md
      .split("\n")
      .map((l, i) => (i === 0 ? `- ${l}` : l === "" ? "" : `  ${l}`))
      .join("\n");
  }
  return md;
}

/** Inverse of {@link wrapKind}; null when `raw` is not exactly the wrapped form of some md. */
export function unwrapKind(kind: BlockKind, raw: string, lang: DocLang): string | null {
  if (isCallout(kind)) {
    const head = alertHead(kind, lang);
    const lines = raw.split("\n");
    for (let i = 0; i < head.length; i++) if (lines[i] !== head[i]) return null;
    const body: string[] = [];
    for (const l of lines.slice(head.length)) {
      if (l === ">") body.push("");
      else if (l.startsWith("> ") && l.length > 2) body.push(l.slice(2));
      else return null;
    }
    const md = body.join("\n");
    return wrapKind(kind, md, lang) === raw ? md : null;
  }
  if (kind === "question") {
    if (!raw.startsWith("- ")) return null;
    const lines = raw.split("\n");
    const md = lines.map((l, i) => (i === 0 ? l.slice(2) : l.startsWith("  ") ? l.slice(2) : l)).join("\n");
    return wrapKind(kind, md, lang) === raw ? md : null;
  }
  return raw;
}

/** Infer the alert kind of a blockquote (`> [!TYPE]` + label line). Null when it is not one of ours. */
export function inferCallout(raw: string, lang: DocLang): { kind: BlockKind; md: string } | null {
  if (!raw.startsWith("> [!")) return null;
  for (const kind of CALLOUT_KINDS) {
    const md = unwrapKind(kind, raw, lang);
    if (md !== null) return { kind, md };
  }
  return null;
}

/** Last line belongs to a code block (a trailing comment there would break the closing fence or become code). */
function endsInCode(text: string): boolean {
  // fast path: no fence and no run of 4 spaces / tab anywhere (indented code can start after `> ` or `- ` markers)
  if (!text.includes("```") && !text.includes("~~~") && !/ {4}|\t/.test(text)) return false;
  const n = text.split("\n").length;
  return codeLines(text, n)[n - 1] === true;
}

/** Wrapped block + its ID comment (§10.2-2). */
export function blockFragment(kind: BlockKind, md: string, id: BlockId, lang: DocLang): string {
  const body = wrapKind(kind, md, lang);
  const ownLine = body === "" ? `<!-- ${id} -->` : `${body}\n<!-- ${id} -->`;
  if (BLOCK_ID_PLACEMENT[kind] === "own_line" || endsInCode(body)) return ownLine;
  const nl = body.lastIndexOf("\n");
  const head = nl < 0 ? "" : body.slice(0, nl + 1);
  const last = body.slice(nl + 1).replace(/[ \t]+$/, "");
  const trailing = `${head}${last}${last === "" ? "" : " "}<!-- ${id} -->`;
  // the appended comment can change how its line parses (`-     ---` is a rule, `-     --- <!-- … -->` indented code)
  return endsInCode(trailing) ? ownLine : trailing;
}
