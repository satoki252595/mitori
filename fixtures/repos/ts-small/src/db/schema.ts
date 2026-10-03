import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const books = sqliteTable("books", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  isbn: text("isbn").notNull().unique(),
  title: text("title").notNull(),
  status: text("status").notNull().default("unread"),
  addedAt: text("added_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const bookTags = sqliteTable("book_tags", {
  bookId: integer("book_id")
    .notNull()
    .references(() => books.id),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id),
});
