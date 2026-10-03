"""Book metadata lookup by ISBN (standard library only)."""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field

# A failed lookup is retried exactly once: one initial attempt plus MAX_RETRIES more.
MAX_RETRIES = 1

ENDPOINT = "https://openlibrary.org/api/books"


@dataclass(frozen=True)
class Metadata:
    title: str
    authors: list[str] = field(default_factory=list)
    pages: int | None = None


def normalize_isbn(raw: str) -> str:
    """Strip hyphens and spaces and upper-case a trailing X."""
    return raw.replace("-", "").replace(" ", "").upper()


# FIXME: handle ISBN-10 checksum
def is_plausible_isbn(isbn: str) -> bool:
    """Cheap sanity check: 10 or 13 characters, digits only (the last one of an ISBN-10 may be X)."""
    body = isbn[:-1] if len(isbn) == 10 else isbn
    return len(isbn) in (10, 13) and body.isdigit()


def fetch_metadata(raw_isbn: str, opener: Callable[..., object] = urllib.request.urlopen) -> Metadata:
    """Look a book up. Network and HTTP errors are retried; the error of the last attempt is raised."""
    isbn = normalize_isbn(raw_isbn)
    url = f"{ENDPOINT}?bibkeys=ISBN:{isbn}&format=json&jscmd=data"
    last_error: Exception | None = None
    for _attempt in range(MAX_RETRIES + 1):
        try:
            with opener(url, timeout=10) as response:  # type: ignore[operator]
                body = json.load(response)
            entry = body[f"ISBN:{isbn}"]
            return Metadata(
                title=entry["title"],
                authors=[a["name"] for a in entry.get("authors", [])],
                pages=entry.get("number_of_pages"),
            )
        except Exception as err:  # noqa: BLE001 - every failure of one attempt is retried the same way
            last_error = err
    assert last_error is not None
    raise last_error
