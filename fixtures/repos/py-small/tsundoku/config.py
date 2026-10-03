"""Runtime configuration, read from the environment on every call (so tests can patch os.environ)."""

import os

LOG_LEVELS = ("debug", "info", "warning", "error")


def port() -> int:
    """TCP port of the HTTP service."""
    return int(os.getenv("PORT", "8000"))


def database_url() -> str:
    """SQLite path of the SQL-backed repo; there is no sensible default, so a missing variable is an error."""
    return os.environ["DATABASE_URL"]


def log_level() -> str:
    """One of LOG_LEVELS; unknown values fall back to info."""
    level = os.environ.get("LOG_LEVEL", "info").lower()
    return level if level in LOG_LEVELS else "info"


def api_token() -> str | None:
    """Bearer token required for writes, or None when authentication is disabled."""
    return os.getenv("TSUNDOKU_API_TOKEN")
