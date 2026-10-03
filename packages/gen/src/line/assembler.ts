/**
 * Text deltas → complete NDJSON lines (gen spec §3.6-1/2). `\r` is dropped; BOM and leading whitespace are
 * trimmed. While a block line is still open, `partial()` decodes its `md` string so far (markers removed) for
 * `doc.block.partial`; keys are emitted in a fixed order, so `md` appears early in the line.
 */
import type { BlockAspect, BlockKind, SectionId } from "@mitori/core";
import type { LineAssembler } from "../contract.ts";

/** What `partial()` exposes internally (the contract shape plus aspect/kind for CR gen-C12). */
export interface PartialBlock {
  /** Section, when the open line names one. */
  section: SectionId | null;
  /** Decoded md so far, markers stripped. */
  md: string;
  /** Aspect, when already streamed. */
  aspect?: BlockAspect;
  /** Kind, when already streamed. */
  kind?: BlockKind;
}

/** Assembler with the richer partial view. */
export interface GenLineAssembler extends LineAssembler {
  /** Partial view of the open block line. */
  partial(): PartialBlock | null;
}

function clean(line: string): string {
  return line.replace(/\r/g, "").replace(/^﻿/, "").replace(/^\s+/, "");
}

/** Factory. */
export function createAssembler(): GenLineAssembler {
  let buf = "";
  return {
    push(delta: string): string[] {
      if (delta === "") return [];
      buf += delta;
      const out: string[] = [];
      let from = 0;
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n", from)) {
        out.push(clean(buf.slice(from, nl)));
        from = nl + 1;
      }
      if (from > 0) buf = buf.slice(from);
      return out;
    },
    end(): string | null {
      const rest = clean(buf);
      buf = "";
      return rest === "" ? null : rest;
    },
    partial(): PartialBlock | null {
      const open = clean(buf);
      if (!/^\{\s*"t"\s*:\s*"block"/.test(open)) return null;
      const at = open.search(/"md"\s*:\s*"/);
      if (at < 0) return null;
      const head = open.slice(0, at);
      const startOfValue = open.indexOf('"', open.indexOf(":", at + 4)) + 1;
      const md = decodePartialString(open, startOfValue)
        .replace(/\[\[[1-9][0-9]?\]\]/g, "")
        .replace(/\[\[?[0-9]*\]?$/, "");
      const p: PartialBlock = { section: (field(head, "section") as SectionId | undefined) ?? null, md };
      const aspect = field(head, "aspect");
      const kind = field(head, "kind");
      if (aspect) p.aspect = aspect as BlockAspect;
      if (kind) p.kind = kind as BlockKind;
      return p;
    },
  };
}

function field(head: string, key: string): string | undefined {
  return new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*)"`).exec(head)?.[1];
}

/** Decode a JSON string body from `from` until its closing quote or the end of the buffer (incomplete escapes are dropped). */
function decodePartialString(s: string, from: number): string {
  let out = "";
  for (let i = from; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '"') break;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = s[i + 1];
    if (e === undefined) break;
    i++;
    switch (e) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        break;
      case "b":
      case "f":
        break;
      case "u": {
        const hex = s.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        out += e;
    }
  }
  return out;
}
