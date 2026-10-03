"""CSV helpers on the standard library's csv module."""

from __future__ import annotations

import csv
import io


def parse_rows(text: str) -> list[dict[str, str]]:
    """Parse CSV text with a header row into one dict per record (header names trimmed and lower-cased).

    Quoted fields may contain commas, line breaks and doubled quotes; blank lines are skipped.
    """
    reader = csv.reader(io.StringIO(text, newline=""))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        return []
    header = [name.strip().lower() for name in rows[0]]
    return [dict(zip(header, (cell.strip() for cell in row), strict=False)) for row in rows[1:]]


def write_rows(rows: list[dict[str, str]], columns: list[str]) -> str:
    """Render records as CSV text with the given column order."""
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()
