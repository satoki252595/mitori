-- 0001_init: the pile, its tags and the link table.
CREATE TABLE books (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  isbn      TEXT NOT NULL UNIQUE,
  title     TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'done', 'abandoned')),
  added_at  TEXT NOT NULL
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE book_tags (
  book_id  INTEGER NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

CREATE INDEX idx_books_status ON books (status);
