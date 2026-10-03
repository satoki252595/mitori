"""SQLAlchemy models (the SQL-backed repo is not wired in yet; repo.py uses sqlite3 directly)."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    isbn: Mapped[str] = mapped_column(unique=True)
    title: Mapped[str]
    status: Mapped[str] = mapped_column(default="unread")
    added_at: Mapped[str]


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
