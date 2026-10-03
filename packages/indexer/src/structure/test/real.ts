/**
 * Test-only: the S2 input of a repository as the real facade produces it (WP-02's S0 inventory + parse Worker), so the
 * S3 quality acceptance runs on the same symbols, imports and refs as the product. The later stages are captured at
 * the seam (`createIndexerWith`), exactly as `update/later.ts` builds its `StageFile`s. Memoized per root.
 */
import type { RepoPath } from "@mitori/core";
import { isResolverConfig, type StageFile, type StageInput } from "../../resolve/files.ts";
import { createIndexerWith } from "../../update/facade.ts";
import { laterStages } from "../../update/later.ts";
import type { IndexView } from "../../update/stages.ts";
import { testDeps } from "../../update/test/deps.ts";

const cache = new Map<string, Promise<StageInput>>();

/** S0–S1 of `root` through the real facade, as the later stages see it. */
export function loadReal(root: string): Promise<StageInput> {
  let p = cache.get(root);
  if (!p) {
    p = capture(root);
    cache.set(root, p);
  }
  return p;
}

async function capture(root: string): Promise<StageInput> {
  let view: IndexView | null = null;
  const idx = createIndexerWith(testDeps(root), (v) => {
    view = v;
    return laterStages(v);
  });
  try {
    await idx.scan({ until: "S1" });
    const v = view as IndexView | null;
    if (v === null) throw new Error("the facade did not create its later stages");
    const files: StageFile[] = [];
    for (const path of v.paths()) {
      const d = v.file(path);
      if (d === null) continue;
      const parsed = v.parsed(path);
      const f: StageFile = {
        path,
        blob: d.blob,
        lang: d.lang,
        class: d.class,
        scope: d.scope,
        lines: d.lines,
        loc: d.loc,
        symbols: parsed === null ? [] : v.symbolDetails(path),
        imports: parsed?.imports ?? [],
        refs: parsed?.refs ?? [],
        tests: parsed?.tests ?? [],
        facts: parsed?.facts ?? [],
      };
      if (d.excluded !== undefined) f.excluded = d.excluded;
      if (parsed?.headings !== undefined) f.headings = parsed.headings;
      files.push(f);
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const texts = new Map<RepoPath, string>();
    for (const f of files) {
      if (!isResolverConfig(f.path) || f.excluded === "deny_glob" || f.excluded === "secret") continue;
      const t = await v.text(f.path);
      if (t !== null) texts.set(f.path, t);
    }
    return { files, texts };
  } finally {
    await idx.close();
  }
}
