/**
 * Scripted replies for S9 / on-demand tests: the M2 replies of `validRouter`, plus regenerations that answer for the
 * EXISTING blocks by id, doc.sync patches that re-cite the changed claims on the new lines, doc.translate /
 * doc.simplify rewrites that keep every marker, deep dives replacing their placeholder and minimal M4 section pages.
 */
import type { GenCall } from "../../contract.ts";
import { firstShown, type ScriptReply, type Turn, validRouter } from "../../test/fake-engine.ts";

const j = (o: unknown) => JSON.stringify(o);
const end = (n: number) => j({ t: "end", blocks: n });

/** Lines of one DATA section of a user message. */
export function dataSection(message: string, label: string): string[] {
  const lines = message.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^<<<DATA \\w{8} ${label}>>>$`).test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^<<<END \w{8}>>>$/.test(l)) break;
    out.push(l);
  }
  return out;
}

/** BLOCKS entries: id, md lines, claims (`n → "<kind> <ranges>"`). */
export function parseBlocks(message: string): { id: string; md: string; claims: Map<number, string> }[] {
  const out: { id: string; md: string[]; claims: Map<number, string> }[] = [];
  for (const l of dataSection(message, "BLOCKS")) {
    const h = /^> block (b_\w{8}) /.exec(l);
    if (h) {
      out.push({ id: h[1] as string, md: [], claims: new Map() });
      continue;
    }
    const cur = out.at(-1);
    if (!cur) continue;
    const c = /^> claim \[\[(\d+)\]\] (\S+)(?: (.+))?$/.exec(l);
    if (c) cur.claims.set(Number(c[1]), `${c[2]}${c[3] ? ` ${c[3].replace(/, /g, ",")}` : ""}`);
    else if (l.startsWith("> ")) cur.md.push(l.slice(2));
  }
  return out.map((b) => ({ id: b.id, md: b.md.join("\n"), claims: b.claims }));
}

/** CHANGES: per `<block> [[n]]` the first new line shown for it. */
function changedCites(message: string): Map<string, string> {
  const out = new Map<string, string>();
  let key: string | null = null;
  let file: string | null = null;
  for (const l of dataSection(message, "CHANGES")) {
    const c = /^> claim (b_\w{8}) \[\[(\d+)\]\]/.exec(l);
    if (c) {
      key = `${c[1]}#${c[2]}`;
      file = null;
      continue;
    }
    const h = /^=== (\S+)/.exec(l);
    if (h) {
      file = h[1] as string;
      continue;
    }
    const n = /^(\d+)\|/.exec(l);
    if (n && key && file && !out.has(key)) out.set(key, `${file}:${n[1]}-${n[1]}`);
  }
  return out;
}

/** Shown `path:n-n` lines of the SKELETON section, in order. */
export function skeletonLines(message: string): string[] {
  const out: string[] = [];
  let file: string | null = null;
  for (const l of dataSection(message, "SKELETON")) {
    const h = /^=== (\S+)/.exec(l);
    if (h) {
      file = h[1] as string;
      continue;
    }
    const n = /^(\d+)\|/.exec(l);
    if (n && file) out.push(`${file}:${n[1]}-${n[1]}`);
  }
  return out;
}

/** EXISTING ids by aspect. */
function existingByAspect(message: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of dataSection(message, "EXISTING")) {
    const m = /^> (b_\w{8}) aspect=(\S+) /.exec(l);
    if (m && !out.has(m[2] as string)) out.set(m[2] as string, m[1] as string);
  }
  return out;
}

/** Options of {@link s9Router}. */
export interface S9RouterOptions {
  /** Module pages also write one deep-dive placeholder block (aspect deepdive, no claims). */
  deepdive?: boolean;
  /** Question lines every module page emits. */
  questionsPerModule?: number;
  /** doc.sync rewrites the blocks it re-cites (otherwise it keeps the text and only moves the cites). */
  syncRewrite?: boolean;
  /**
   * Last line of the symbol whose signature is at `path:line` (null: none): interface claims then cite the whole
   * symbol, as a model does when the signature was shown (CitableSet allows the symbol range), capped at 40 lines.
   */
  symbolEnd?: (path: string, line: number) => number | null;
  /** Module pages cite up to 20 shown symbols (two list blocks) instead of 8. */
  wide?: boolean;
}

/** Router factory. */
export function s9Router(opts: S9RouterOptions = {}): (call: GenCall, t: Turn) => ScriptReply {
  return (call, t) => {
    const msg = call.layout.unit;
    if (t.continuation || t.attempt === 2) return { lines: [end(0)] };
    switch (call.spec.id) {
      case "gen.module": {
        const mod = /TASK: Write the page for module (md_\w{8})/.exec(msg)?.[1] as string;
        const shown = skeletonLines(msg).map((c) => {
          const m = /^(.+):(\d+)-\d+$/.exec(c);
          const end = m && opts.symbolEnd ? opts.symbolEnd(m[1] as string, Number(m[2])) : null;
          return m && end !== null && end > Number(m[2]) ? `${m[1]}:${m[2]}-${Math.min(end, Number(m[2]) + 39)}` : c;
        });
        const first = shown[0];
        const cite = first ? `behavior ${first}` : "behavior";
        const ex = existingByAspect(msg);
        // one interface item per shown signature line, each its own claim (realistic claim counts per page)
        const items = shown.slice(0, 8);
        const iface = items.length > 0 ? items.map((_, i) => `- 公開シンボル ${i + 1} を提供する[[${i + 1}]]。`).join("\n") : "- 公開関数を提供する[[1]]。";
        const ifaceClaims = items.length > 0 ? Object.fromEntries(items.map((x, i) => [String(i + 1), `behavior ${x}`])) : { "1": cite };
        const lines = [
          j({
            t: "block",
            id: ex.get("responsibility") ?? "new:1",
            aspect: "responsibility",
            md: "このモジュールの責務を説明する[[1]]。",
            claims: { "1": cite },
          }),
          j({ t: "block", id: ex.get("interface") ?? "new:2", aspect: "interface", md: iface, claims: ifaceClaims }),
        ];
        // `wide`: a second list (aspect flow) over the next shown symbols, as a real page cites more of the module
        const more = opts.wide ? shown.slice(8, 20) : [];
        if (more.length > 0)
          lines.push(
            j({
              t: "block",
              id: ex.get("flow") ?? "new:4",
              aspect: "flow",
              md: more.map((_, i) => `${i + 1}. 処理 ${i + 1} を行う[[${i + 1}]]。`).join("\n"),
              claims: Object.fromEntries(more.map((x, i) => [String(i + 1), `behavior ${x}`])),
            }),
          );
        if (opts.deepdive) lines.push(j({ t: "block", id: ex.get("deepdive") ?? "new:3", aspect: "deepdive", md: "`Store.get` の期限切れ判定。", claims: {} }));
        // a regenerated page accounts for every EXISTING block: what it does not write again is deleted
        const written = new Set(lines.map((l) => (JSON.parse(l) as { id: string }).id));
        for (const l of dataSection(msg, "EXISTING")) {
          const id = /^> (b_\w{8}) /.exec(l)?.[1];
          if (id && !written.has(id)) lines.push(j({ t: "delete", id }));
        }
        for (let q = 0; q < (opts.questionsPerModule ?? 0); q++) lines.push(j({ t: "question", text: `${mod} の問い ${q + 1}`, cites: [] }));
        lines.push(j({ t: "module", module: mod, name: `名前${mod.slice(-2)}`, summary: "要約" }), end(lines.length));
        return { lines };
      }
      case "doc.sync": {
        const changed = changedCites(msg);
        const out = parseBlocks(msg).map((b) => {
          const claims: Record<string, string> = {};
          for (const [n, c] of b.claims) {
            const kind = c.split(" ")[0] as string;
            const moved = changed.get(`${b.id}#${n}`);
            claims[String(n)] = moved ? `${kind} ${moved}` : c;
          }
          return j({ t: "block", id: b.id, md: opts.syncRewrite ? `更新: ${b.md}` : b.md, claims });
        });
        return { lines: [...out, end(out.length)] };
      }
      case "doc.translate": {
        const out = parseBlocks(msg).map((b) => j({ t: "block", id: b.id, md: `EN ${b.md}` }));
        return { lines: [...out, end(out.length)] };
      }
      case "doc.simplify": {
        const out = parseBlocks(msg).map((b) => j({ t: "block", id: b.id, md: `やさしく言うと、${b.md}` }));
        return { lines: [...out, end(out.length)] };
      }
      case "gen.deepdive": {
        const id = /^> block (b_\w{8})/m.exec(dataSection(msg, "TOPIC").join("\n"))?.[1] as string;
        const shown = firstShown(msg);
        const cite = shown ? `behavior ${shown.path}:${shown.line}-${shown.line}` : "behavior";
        return {
          lines: [
            j({ t: "block", id, aspect: "deepdive", md: "期限は `get` で判定する[[1]]。", claims: { "1": cite } }),
            j({ t: "block", id: "new:1", after: id, aspect: "deepdive", md: "期限切れは例外になる[[1]]。", claims: { "1": cite } }),
            end(2),
          ],
        };
      }
      case "gen.flows": {
        // one flow per seed (≤ 3), its steps citing the seed's entry line (a `path:line` location is citable)
        const seeds = dataSection(msg, "SEEDS")
          .map((l) => /^> seed(\d+) \S+ .*? (\S+):(\d+) path:/.exec(l))
          .filter((m): m is RegExpExecArray => m !== null)
          .slice(0, 3);
        if (seeds.length === 0) return validRouter(call, t);
        const lines = [j({ t: "block", id: "new:1", aspect: "intro", md: "入口から処理が流れる。", claims: {} })];
        let n = 1;
        for (const m of seeds) {
          lines.push(j({ t: "flow", key: `flow-${m[1]}`, title: `流れ ${m[1]}` }));
          lines.push(j({ t: "block", id: `new:${++n}`, aspect: "summary", md: "入口の流れだ。", claims: {} }));
          lines.push(j({ t: "block", id: `new:${++n}`, aspect: "steps", md: "1. 入口で受け付ける[[1]]", claims: { "1": `behavior ${m[2]}:${m[3]}-${m[3]}` } }));
        }
        lines.push(end(n));
        return { lines };
      }
      case "gen.datamodel":
        return {
          lines: [
            j({ t: "block", id: existingByAspect(msg).get("overview") ?? "new:1", aspect: "overview", md: "主なエンティティを説明する。", claims: {} }),
            end(1),
          ],
        };
      case "gen.quality": {
        const shown = firstShown(msg);
        const cite = shown ? `performance ${shown.path}:${shown.line}-${shown.line}` : "performance";
        return {
          lines: [
            j({
              t: "block",
              id: existingByAspect(msg).get("hotpaths") ?? "new:1",
              aspect: "hotpaths",
              kind: "prose",
              md: "ホットパスを述べる[[1]]。",
              claims: { "1": cite },
            }),
            end(1),
          ],
        };
      }
      case "gen.questions": {
        const raw = dataSection(msg, "RAW").filter((l) => /^> q\d+ /.test(l));
        return { lines: [j({ t: "question", section: "s13", text: `統合した問い（${raw.length} 件から）`, from: ["q1", "q2"] }), end(0)] };
      }
      default:
        return validRouter(call, t);
    }
  };
}
