"""Command line (argparse): tsundoku import | export | serve."""

from __future__ import annotations

import argparse
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

from tsundoku.config import port
from tsundoku.importer import export_books, import_csv


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tsundoku", description="Manage the pile of books you have not read yet")
    sub = parser.add_subparsers(dest="command", required=True)

    imp = sub.add_parser("import", help="import books from a CSV file (isbn,title,status)")
    imp.add_argument("file", type=Path)
    imp.add_argument("--dry-run", action="store_true", help="validate the file without storing anything")

    exp = sub.add_parser("export", help="print the pile")
    exp.add_argument("--format", default="json", help="output format")

    srv = sub.add_parser("serve", help="start the HTTP service")
    srv.add_argument("-p", "--port", type=int, default=None, help="port to listen on")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "import":
        result = import_csv(args.file.read_text(encoding="utf-8"), dry_run=args.dry_run)
        print(f"{'would import' if args.dry_run else 'imported'} {result.imported}, skipped {result.skipped}")
        for error in result.errors:
            print(error, file=sys.stderr)
        return 1 if result.errors else 0
    if args.command == "export":
        print(export_books(args.format))
        return 0
    listen = args.port if args.port is not None else port()
    return subprocess.call([sys.executable, "-m", "uvicorn", "tsundoku.api:app", "--port", str(listen)])
