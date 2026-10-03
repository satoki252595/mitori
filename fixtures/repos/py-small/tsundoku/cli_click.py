"""Reporting commands (click): tsundoku-stats stats."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime

import click


@click.group()
def cli() -> None:
    """Statistics about an exported pile."""


@cli.command()
@click.argument("export_file", type=click.Path(exists=True, dir_okay=False))
@click.option("--since", type=click.DateTime(formats=["%Y-%m-%d"]), default=None, help="only count books added on or after this day")
def stats(export_file: str, since: datetime | None) -> None:
    """Count the books of an export (tsundoku export > pile.json) per status."""
    with open(export_file, encoding="utf-8") as handle:
        books = json.load(handle)
    if since is not None:
        books = [b for b in books if b["added_at"][:10] >= since.strftime("%Y-%m-%d")]
    for status, count in sorted(Counter(b["status"] for b in books).items()):
        click.echo(f"{status}: {count}")
