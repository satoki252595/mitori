import type { BlockId, ThreadDetail } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import { BUNDLE_LIMITS } from "../contract.ts";
import type { Block } from "./code.ts";
import { bundleDocText, firstSentence, headingText } from "./doc-md.ts";
import type { Estimator } from "./estimate.ts";
import { field, quote, quoteLabelled, safeLine } from "./lines.ts";
import type { TaskPart } from "./plan.ts";

/** Applies the secret scan to a text and counts redactions. */
export type Scrub = (text: string) => string;

const PROSE: ReadonlySet<string> = new Set(["prose", "list", "learn", "recap", "pitfall", "deepdive", "why", "question", "faq"]);

/** Latest human message (the ASK) and the messages before it that are worth showing. */
export function splitConversation(thread: ThreadDetail): { ask: string; earlier: ThreadDetail["messages"] } {
  const msgs = thread.messages;
  let at = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if ((msgs[i] as (typeof msgs)[number]).by === "human") {
      at = i;
      break;
    }
  }
  if (at < 0) return { ask: "", earlier: msgs.filter((m) => m.by !== "system") };
  return { ask: (msgs[at] as (typeof msgs)[number]).body, earlier: msgs.slice(0, at).filter((m) => m.by !== "system") };
}

/** Cut a text to `max` characters with an ellipsis that says how much was left out. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[+${text.length - max}]`;
}

/**
 * The DATA-side parts of one thread (spec §4.3): TASK, DOC (+ neighbours), SEL, THREAD — and its ASK. `seen`
 * holds the doc blocks already shown by an earlier TASK of the same bundle (a batch shows each block once).
 */
export function taskPart(
  thread: ThreadDetail,
  opts: { doc: Pick<DocStore, "block" | "section">; est: Estimator; scrub: Scrub; seen: Set<BlockId>; removed: ReadonlySet<string>; multi: boolean },
): TaskPart {
  const { est, scrub } = opts;
  const head = `TASK ${field(thread.id)} ${thread.intent} R${thread.round}`;
  const { ask, earlier } = splitConversation(thread);

  let doc: Block | null = null;
  let docBlock: BlockId | null = null;
  const neighbors: Block[] = [];
  const da = thread.anchor.doc;
  const b = da ? opts.doc.block(da.block) : null;
  if (da && b) {
    docBlock = b.id;
    const section = opts.doc.section(b.section);
    const blocks = section?.blocks ?? [];
    const idx = blocks.findIndex((x) => x.id === b.id);
    let title = (section?.node.title ?? "").replaceAll('"', '\\"');
    if (idx > 0 && b.kind !== "heading") {
      const above = blocks
        .slice(0, idx)
        .reverse()
        .find((x) => x.kind === "heading");
      const h = above ? headingText(above.md).replaceAll('"', '\\"') : "";
      if (h !== "" && h !== title) title = title === "" ? h : `${title} > ${h}`;
    }
    const docHead = `DOC ${b.id} ${field(b.section)} "${field(title)}" h=${b.hash.slice(0, 8)}`;
    const dup = opts.seen.has(b.id);
    opts.seen.add(b.id);
    const body = dup ? ["> (same as above)"] : quote(scrub(bundleDocText(b.md)));
    doc = { lines: [docHead, ...body], tokens: est.tags([docHead]) + est.quote(body) };
    if (!dup && !opts.removed.has("doc:neighbors") && idx >= 0) {
      const near = (dir: -1 | 1) => {
        for (let i = idx + dir, n = 0; i >= 0 && i < blocks.length && n < 3; i += dir, n++) {
          const x = blocks[i];
          if (x && PROSE.has(x.kind)) return x;
        }
        return null;
      };
      for (const [dir, label] of [
        [-1, "~prev"],
        [1, "~next"],
      ] as const) {
        const x = near(dir);
        const sentence = x ? scrub(firstSentence(x.md)) : "";
        if (sentence !== "") {
          const lines = [`> ${label}: ${safeLine(sentence)}`];
          neighbors.push({ lines, tokens: est.quote(lines) });
        }
      }
    }
  }

  let sel: Block | null = null;
  const exact = da?.quote?.exact;
  if (exact) {
    const text = clip(scrub(exact), BUNDLE_LIMITS.selMaxChars);
    const body = quote(text);
    sel = { lines: ["SEL", ...body], tokens: est.tags(["SEL"]) + est.quote(body) };
  }

  const shown = opts.removed.has("thread") ? [] : earlier.slice(-BUNDLE_LIMITS.threadMaxMessages);
  const msgs = shown.map((m): Block => {
    const text = scrub(m.by.startsWith("agent") ? clip(m.body, BUNDLE_LIMITS.threadAgentMaxChars) : m.body);
    const lines = quoteLabelled(`R${m.round} ${field(m.by)}: `, text);
    return { lines, tokens: est.quote(lines) };
  });

  const askLines = [multiAsk(opts.multi, thread.id), ...quote(scrub(ask), Number.POSITIVE_INFINITY)];
  return {
    id: thread.id,
    head: { lines: [head], tokens: est.tags([head]) },
    doc,
    docBlock,
    neighbors,
    sel,
    msgs,
    total: earlier.length,
    ask: { lines: askLines, tokens: est.tags([askLines[0] as string]) + est.quote(askLines.slice(1)) },
  };
}

function multiAsk(multi: boolean, id: string): string {
  return multi ? `ASK ${id}` : "ASK";
}
