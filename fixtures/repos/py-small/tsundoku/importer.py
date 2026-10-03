"""CSV import and JSON export on top of the repo."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

from tsundoku.csvutil import parse_rows
from tsundoku.repo import Repo, parse_status

# The pile the command line works on (the HTTP service owns its own repo).
SHELF = Repo()


@dataclass
class ImportResult:
    imported: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def import_csv(text: str, dry_run: bool = False, repo: Repo | None = None) -> ImportResult:
    """Import books from CSV text with the columns isbn,title,status. With dry_run nothing is stored."""
    repo = repo or SHELF
    result = ImportResult()
    known = {book.isbn for book in repo.list()}
    for number, record in enumerate(parse_rows(text), start=2):
        isbn, title = record.get("isbn", ""), record.get("title", "")
        if not isbn or not title:
            result.errors.append(f"row {number}: isbn and title are required")
        elif isbn in known:
            result.skipped += 1
        else:
            if not dry_run:
                repo.create(isbn, title, parse_status(record.get("status")))
            known.add(isbn)
            result.imported += 1
    return result


def export_books(fmt: str = "json", repo: Repo | None = None) -> str:
    """Serialize the pile. Only json is supported so far."""
    if fmt != "json":
        raise ValueError(f"unsupported export format: {fmt}")
    return json.dumps([asdict(book) for book in (repo or SHELF).list()], ensure_ascii=False, indent=2)
