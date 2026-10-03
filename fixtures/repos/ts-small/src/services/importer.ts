import { BookRepo, parseStatus } from "@app/db/repo";
import { parseCsvRecords } from "@app/lib/csv";

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/** The pile the command-line tool works on (the HTTP service owns its own repo). */
const shelf = new BookRepo();

/** Import books from CSV text with the columns `isbn,title,status`. With `dryRun` nothing is stored. */
export function importCsv(text: string, opts: { dryRun?: boolean } = {}, repo: BookRepo = shelf): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
  for (const [i, record] of parseCsvRecords(text).entries()) {
    const isbn = record.isbn?.trim();
    const title = record.title?.trim();
    if (!isbn || !title) {
      result.errors.push(`row ${i + 2}: isbn and title are required`);
      continue;
    }
    if (repo.list().some((b) => b.isbn === isbn)) {
      result.skipped++;
      continue;
    }
    if (!opts.dryRun) repo.create({ isbn, title, status: parseStatus(record.status) });
    result.imported++;
  }
  return result;
}

/** Serialize the pile. Only `json` is supported so far. */
export function exportBooks(format: string, repo: BookRepo = shelf): string {
  if (format !== "json") throw new Error(`unsupported export format: ${format}`);
  return JSON.stringify(repo.list(), null, 2);
}
