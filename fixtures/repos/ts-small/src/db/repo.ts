import { BOOK_STATUSES, type Book, type BookStatus, type NewBook } from "./types.ts";

/** Parse a user-supplied status; anything unknown (or missing) means the book has not been started. */
export function parseStatus(value: string | undefined): BookStatus {
  const status = BOOK_STATUSES.find((s) => s === value?.trim().toLowerCase());
  return status ?? "unread";
}

/** In-memory book store. The SQLite-backed repo (drizzle, see schema.ts) exposes the same four operations. */
export class BookRepo {
  #books = new Map<number, Book>();
  #nextId = 1;
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  /** All books, oldest first. */
  list(): Book[] {
    return [...this.#books.values()];
  }

  /** One book, or undefined when the id is unknown. */
  get(id: number): Book | undefined {
    return this.#books.get(id);
  }

  /** Add a book and return it with its new id. The same ISBN is only stored once. */
  create(input: NewBook): Book {
    const existing = this.list().find((b) => b.isbn === input.isbn);
    if (existing) return existing;
    const book: Book = {
      id: this.#nextId++,
      isbn: input.isbn,
      title: input.title,
      status: input.status ?? "unread",
      addedAt: this.#now().toISOString(),
    };
    this.#books.set(book.id, book);
    return book;
  }

  /** Remove a book; returns whether something was removed (removing twice is fine). */
  remove(id: number): boolean {
    return this.#books.delete(id);
  }

  /** Number of books per status, every status present. */
  countByStatus(): Record<BookStatus, number> {
    const counts: Record<BookStatus, number> = { unread: 0, reading: 0, done: 0, abandoned: 0 };
    for (const book of this.#books.values()) counts[book.status]++;
    return counts;
  }
}
