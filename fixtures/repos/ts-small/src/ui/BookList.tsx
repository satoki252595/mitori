/** @jsxImportSource hono/jsx */
import type { Book } from "@app/db/types";

const LABEL: Record<Book["status"], string> = {
  unread: "未読",
  reading: "読書中",
  done: "読了",
  abandoned: "積んだまま",
};

/** The pile as a list; each row carries its status so CSS can colour it. */
export function BookList(props: { books: Book[] }) {
  if (props.books.length === 0) return <p class="empty">積読はありません</p>;
  return (
    <ul class="books">
      {props.books.map((book) => (
        <li key={book.id} data-status={book.status}>
          <span class="title">{book.title}</span>
          <span class="status">{LABEL[book.status]}</span>
        </li>
      ))}
    </ul>
  );
}
