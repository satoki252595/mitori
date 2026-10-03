/** Reading state of a book on the pile. */
export type BookStatus = "unread" | "reading" | "done" | "abandoned";

export const BOOK_STATUSES: readonly BookStatus[] = ["unread", "reading", "done", "abandoned"];

/** A book on the tsundoku pile. */
export interface Book {
  id: number;
  isbn: string;
  title: string;
  status: BookStatus;
  /** ISO 8601 timestamp of the moment the book was added. */
  addedAt: string;
}

/** Input of `BookRepo.create`. */
export interface NewBook {
  isbn: string;
  title: string;
  status?: BookStatus;
}

/** A free-form label ("novel", "reference", ...). */
export interface Tag {
  id: number;
  name: string;
}

/** Link row between a book and a tag. */
export interface BookTag {
  bookId: number;
  tagId: number;
}
