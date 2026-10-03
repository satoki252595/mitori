/**
 * Line sink of `doc.translate` (gen spec §12, D5): a translated block is STORED, not proposed —
 * `DocStore.putTranslation({block, srcHash, lang, md, promptVer, model})` keyed by the source block's semantic hash
 * at gathering time, so the record goes stale by itself when the original text changes. Claims are not re-stamped:
 * the translation keeps the claim ids of the original (markers [[1]]..[[n]], V14 checked by the line validator) and
 * cite links are rendered in the target language's format when shown.
 */
import type { BlockId, DocLang, Logger, ModelId, PromptVersion, WriteQueue, Xxh3 } from "@mitori/core";
import { toErrorData } from "@mitori/core";
import type { DocStore, NewBlockRef } from "@mitori/doc";
import type { GenLine, GenQuestionLine, GenTermLine } from "../contract.ts";
import type { LineSink } from "../orchestrator/apply.ts";

/** What one translation task stores. */
export interface TranslationContext {
  /** Target language. */
  lang: DocLang;
  /** Prompt version (`doc.translate@n`). */
  promptVer: PromptVersion;
  /** Model that translated. */
  model: ModelId;
  /** Source hash of every block shown in BLOCKS (gathering time). */
  hashes: ReadonlyMap<BlockId, Xxh3>;
}

/** Ports. */
export interface TranslationSinkDeps {
  /** Doc store. */
  doc: Pick<DocStore, "putTranslation">;
  /** Write queue. */
  write: WriteQueue;
  /** Logger. */
  log: Logger;
}

/** Stores each translated block line as a {@link TranslationRecord} (one write slot per line, in arrival order). */
export class TranslationSink implements LineSink {
  readonly idMap: Record<NewBlockRef, BlockId> = {};
  /** Blocks translated. */
  readonly written: BlockId[] = [];
  readonly created: BlockId[] = [];
  readonly lines: string[] = [];
  readonly terms: GenTermLine[] = [];
  readonly questions: GenQuestionLine[] = [];
  readonly checks = { l0Raw: 0, l1Pass: 0, l1Fail: 0, l1Vacuous: 0, repaired: 0 };
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: TranslationSinkDeps,
    private readonly ctx: TranslationContext,
  ) {}

  accept(line: GenLine): void {
    this.lines.push(JSON.stringify(line));
    if (line.t !== "block") return;
    const block = line.id as BlockId;
    const srcHash = this.ctx.hashes.get(block);
    if (srcHash === undefined) return; // not a block of this task (the validator already rejects unlisted ids)
    const rec = { block, srcHash, lang: this.ctx.lang, md: line.md, promptVer: this.ctx.promptVer, model: this.ctx.model };
    this.chain = this.chain.then(() =>
      this.deps
        .write("gen.translate", () => this.deps.doc.putTranslation(rec))
        .then(() => {
          this.written.push(block);
        })
        .catch((err: unknown) => {
          this.deps.log.warn("gen.translate.failed", { block, code: toErrorData(err).code });
        }),
    );
  }

  finish(): Promise<void> {
    return this.chain;
  }
}
