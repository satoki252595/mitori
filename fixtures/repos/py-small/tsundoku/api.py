"""HTTP API (FastAPI).

Clients talk to "/books" below the "/api" prefix; "/healthz" is for the load balancer.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel

from tsundoku.config import api_token
from tsundoku.metadata import fetch_metadata
from tsundoku.repo import Repo

app = FastAPI(title="tsundoku")
router = APIRouter(prefix="/api")
repo = Repo()


class NewBook(BaseModel):
    isbn: str
    title: str | None = None
    status: str = "unread"


def require_token(authorization: str | None = Header(default=None)) -> None:
    """Writes need `Authorization: Bearer <token>` when TSUNDOKU_API_TOKEN is configured."""
    expected = api_token()
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="missing or wrong API token")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/books")
def list_books() -> list[dict]:
    return [asdict(book) for book in repo.list()]


@router.get("/books/{book_id}")
def get_book(book_id: int) -> dict:
    book = repo.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="book not found")
    return asdict(book)


@router.post("/books", status_code=201, dependencies=[Depends(require_token)])
def create_book(body: NewBook) -> dict:
    title = body.title or fetch_metadata(body.isbn).title
    return asdict(repo.create(body.isbn, title, body.status))


@router.delete("/books/{book_id}", status_code=204, dependencies=[Depends(require_token)])
def delete_book(book_id: int) -> Response:
    repo.remove(book_id)
    return Response(status_code=204)


app.include_router(router)
