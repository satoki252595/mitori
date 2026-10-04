// Inputs of the export e2e (@export): a checkout of a corpus repo with the committed dogfood doc as its `.mitori/`
// (docs/progress/dogfood/<name>/), and the `secrets` fixture with a small hand-written doc that quotes secrets, cites
// code that contains them and puts `</script>` into several kinds of text.
//
// Two phases, like a real checkout: `.mitori/` first holds only the manifest (so the static doc gets the doc's block
// ids), the prose arrives once the daemon's index is ready (`bringDoc` / `bringSecretsDoc`) — what `git pull` or an
// editor does to a running daemon. A doc read BEFORE the first scan has nothing to stamp its cite links against and
// every claim comes out `unsupported`.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../../..");

/** The planted secrets (fake values with real shapes); the export must contain none of them. */
export const PLANTED = {
  aws: "AKIAJ3Q7XK2M5N8P4RWT",
  github: "ghp_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ",
  stripe: "sk_live_51Hq7YtL2m9XkP4rVb8NcZ0aW",
  password: "Tr0ub4dor&3xKq9Zp",
  dbUrl: "postgres://admin:s3cr3tPassw0rd9@db.internal:5432/billing",
} as const;

/** `~/.cache/mitori-corpus/<name>@<sha>/` of `scripts/fetch-corpus.ts` (or `$MITORI_CORPUS_DIR/<name>`), null when absent. */
export function corpusDir(name: string): string | null {
  const dirs = [process.env.MITORI_CORPUS_DIR, join(homedir(), ".cache/mitori-corpus")].filter((d): d is string => !!d);
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d).find((f) => f === name || f.startsWith(`${name}@`));
    if (hit) return join(d, hit);
  }
  return null;
}

/** A temp copy of a corpus repo with the dogfood doc's manifest in `.mitori/`. Null when the corpus is not fetched. */
export function prepareDogfood(name: string, work: string): string | null {
  const src = corpusDir(name);
  const doc = join(ROOT, "docs/progress/dogfood", name);
  if (!src || !existsSync(doc)) return null;
  const root = join(work, name);
  rmSync(root, { recursive: true, force: true });
  cpSync(src, root, { recursive: true });
  const dest = join(root, ".mitori");
  mkdirSync(dest, { recursive: true });
  cpSync(join(doc, "mitori.json"), join(dest, "mitori.json"));
  return root;
}

/** The dogfood prose (`doc/**.md`) into the repo's `.mitori/`. */
export function bringDoc(root: string, name: string): void {
  cpSync(join(ROOT, "docs/progress/dogfood", name, "doc"), join(root, ".mitori/doc"), { recursive: true, force: true });
}

const MANIFEST = {
  kind: "mitori/doc-manifest",
  schemaVersion: 1,
  docId: "doc_s3cretsfxtr",
  title: "tsundoku-billing",
  primaryLang: "ja",
  snapshot: { commit: null, indexDigest: "" },
  generator: { mitoriVersion: "0.0.0", prompts: {}, extractors: {} },
  models: ["claude-sonnet-5-5"],
  effort: null,
  coverage: { filesTotal: 0, filesIncluded: 0, filesExcluded: {}, locIncluded: 0, modulesTotal: 0, modulesGenerated: 0, claimsTotal: 0, claimsVerified: 0 },
  usageTotals: { apiUsd: 0, cacheRead: 0, cacheWrite: 0, calls: 0, in: 0, out: 0 },
  generatedAt: null,
};

/**
 * The `secrets` fixture repo with a source file that really contains the planted secrets (`src/legacy.ts`, so the
 * indexer includes it and a cite into it is embedded unless the redaction works) and the doc manifest.
 */
export function plantSecrets(root: string): void {
  writeFileSync(
    join(root, "src/legacy.ts"),
    [
      "// legacy configuration kept for the migration",
      `export const AWS_ACCESS_KEY_ID = "${PLANTED.aws}";`,
      `export const GITHUB_TOKEN = "${PLANTED.github}";`,
      `export const STRIPE_SECRET = "${PLANTED.stripe}";`,
      `export const DATABASE_URL = "${PLANTED.dbUrl}";`,
      `const password = "${PLANTED.password}";`,
      "export function legacyHeaders(): Record<string, string> {",
      "  return { authorization: `Bearer ${GITHUB_TOKEN}`, password };",
      "}",
      "",
    ].join("\n"),
  );
  mkdirSync(join(root, ".mitori"), { recursive: true });
  writeFileSync(join(root, ".mitori/mitori.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
}

/**
 * The doc of the secrets case: prose, a code fence and cites that mention the secrets, plus `</script>` in prose, a code
 * fence, an image alt and a link title.
 */
export function bringSecretsDoc(root: string): void {
  const dir = join(root, ".mitori/doc");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "00-tldr.md"),
    [
      "# 0. ひとことで <!-- b_s3cr0001 -->",
      "",
      `請求書の合計を出す小さなサービスである（[billing.ts:8](../../src/billing.ts#L8)）。移行用の古い設定が \`src/legacy.ts\` に残っており、AWS の鍵 ${PLANTED.aws} と GitHub のトークン ${PLANTED.github} を直書きしている（[legacy.ts:2-4](../../src/legacy.ts#L2-L4)）。 <!-- b_s3cr0002 -->`,
      "",
      "```sh",
      `export STRIPE_API_KEY="${PLANTED.stripe}"`,
      `psql "${PLANTED.dbUrl}"`,
      "```",
      "<!-- b_s3cr0003 -->",
      "",
      `パスワードは \`password = "${PLANTED.password}"\` のように書かれている（[legacy.ts:6](../../src/legacy.ts#L6)）。 <!-- b_s3cr0004 -->`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "01-what-why.md"),
    [
      "# 1. これは何か <!-- b_s3cr0005 -->",
      "",
      '本文に </script><script>window.__pwned=2</script> と <!-- コメント --> と ![画像](https://example.com/tracker.png) と [外部](https://example.com/x "</script>") を含める。 <!-- b_s3cr0006 -->',
      "",
      "```html",
      "<script>window.__pwned = 3</script>",
      '<img src="https://example.com/pixel.gif">',
      "```",
      "<!-- b_s3cr0007 -->",
      "",
    ].join("\n"),
  );
}

/** A scratch directory for one e2e run. */
export function workDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `mitori-export-${label}-`));
}
