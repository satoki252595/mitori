"""Endpoints kept for the 2023 desktop client (Flask blueprint); new code goes through api.py."""

from __future__ import annotations

from dataclasses import asdict

from flask import Blueprint, jsonify, request

from tsundoku.repo import Repo

bp = Blueprint("legacy", __name__)
repo = Repo()


@bp.get("/legacy/export")
def export_all():
    return jsonify([asdict(book) for book in repo.list()])


@bp.route("/legacy/import", methods=["POST", "PUT"])
def import_one():
    payload = request.get_json(force=True)
    book = repo.create(payload["isbn"], payload["title"], payload.get("status", "unread"))
    return jsonify(asdict(book)), 201
