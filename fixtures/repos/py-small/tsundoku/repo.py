"""Book repository on sqlite3 (standard library only: the tests import this module without installing anything)."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

STATUSES = ("unread", "reading", "done", "abandoned")
SCHEMA = Path(__file__).resolve().parent.parent / "migrations" / "0001_init.sql"


@dataclass(frozen=True)
class Book:
    id: int
    isbn: str
    title: str
    status: str
    added_at: str


def parse_status(value: str | None) -> str:
    """Normalize a user-supplied status; anything unknown means the book has not been started."""
    status = (value or "").strip().lower()
    return status if status in STATUSES else "unread"


class Repo:
    """The pile of books. Pass a file path for persistence; the default keeps everything in memory."""

    def __init__(self, path: str = ":memory:", now: Callable[[], datetime] | None = None) -> None:
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._db = sqlite3.connect(path)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA.read_text(encoding="utf-8"))

    def list(self) -> list[Book]:
        """All books, oldest first."""
        rows = self._db.execute("SELECT * FROM books ORDER BY id").fetchall()
        return [Book(**dict(row)) for row in rows]

    def get(self, book_id: int) -> Book | None:
        """One book, or None when the id is unknown."""
        row = self._db.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        return Book(**dict(row)) if row else None

    def create(self, isbn: str, title: str, status: str = "unread") -> Book:
        """Add a book and return it with its new id. The same ISBN is stored once."""
        existing = self._db.execute("SELECT * FROM books WHERE isbn = ?", (isbn,)).fetchone()
        if existing:
            return Book(**dict(existing))
        cur = self._db.execute(
            "INSERT INTO books (isbn, title, status, added_at) VALUES (?, ?, ?, ?)",
            (isbn, title, parse_status(status), self._now().isoformat()),
        )
        self._db.commit()
        book = self.get(cur.lastrowid)
        assert book is not None
        return book

    def remove(self, book_id: int) -> bool:
        """Remove a book; returns whether something was removed (removing twice is fine)."""
        cur = self._db.execute("DELETE FROM books WHERE id = ?", (book_id,))
        self._db.commit()
        return cur.rowcount > 0

    def count_by_status(self) -> dict[str, int]:
        """Number of books per status, every status present."""
        counts = dict.fromkeys(STATUSES, 0)
        for row in self._db.execute("SELECT status, COUNT(*) AS n FROM books GROUP BY status"):
            counts[row["status"]] = row["n"]
        return counts
