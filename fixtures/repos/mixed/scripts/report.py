"""Weekly reading report (typer)."""

import json
import os
from datetime import date
from pathlib import Path

import typer

app = typer.Typer(name="report", help="Reports about the pile")

REPORT_DIR = os.environ.get("REPORT_DIR", "reports")


@app.command()
def weekly(since: str = typer.Option(..., "--since", help="first day to include (YYYY-MM-DD)")) -> None:
    """Write reports/weekly-<today>.json with the books added since SINCE."""
    first = date.fromisoformat(since)
    out = Path(REPORT_DIR) / f"weekly-{date.today().isoformat()}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"since": first.isoformat(), "books": []}, indent=2))
    typer.echo(f"wrote {out}")


if __name__ == "__main__":
    app()
