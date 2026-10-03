/** A failed lookup is retried exactly once: one initial attempt plus MAX_RETRIES more. */
export const MAX_RETRIES = 1;

const ENDPOINT = "https://openlibrary.org/api/books";

export interface BookMetadata {
  title: string;
  authors: string[];
  pages?: number;
}

/** Anything that behaves like `fetch` (tests pass a scripted one). */
export type Fetcher = (url: string) => Promise<Response>;

/** Normalize an ISBN-10/13 as typed by a human: digits (and a trailing X), no hyphens or spaces. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function parseResponse(isbn: string, body: unknown): BookMetadata {
  const entry = (body as Record<string, { title?: string; authors?: { name: string }[]; number_of_pages?: number }>)[`ISBN:${isbn}`];
  if (!entry?.title) throw new Error(`no metadata for ISBN ${isbn}`);
  return { title: entry.title, authors: (entry.authors ?? []).map((a) => a.name), pages: entry.number_of_pages };
}

/** Look a book up by ISBN. Network errors and HTTP errors are retried; "not found" is not an error worth retrying. */
export async function fetchMetadata(rawIsbn: string, fetcher: Fetcher = fetch): Promise<BookMetadata> {
  const isbn = normalizeIsbn(rawIsbn);
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetcher(`${ENDPOINT}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      if (!res.ok) throw new Error(`metadata lookup failed: HTTP ${res.status}`);
      return parseResponse(isbn, await res.json());
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
