"""A tiny notes app (Flask). This directory is not a git repository."""

from flask import Flask, jsonify, render_template_string

app = Flask(__name__)

NOTES = [
    {"id": 1, "title": "買い物", "body": "牛乳、卵、パン"},
    {"id": 2, "title": "読みたい本", "body": "積読の消化から"},
]

PAGE = """
<!doctype html>
<title>notes</title>
<ul>{% for n in notes %}<li>{{ n.title }}</li>{% endfor %}</ul>
<script src="/static/app.js"></script>
"""


@app.route("/")
def index():
    return render_template_string(PAGE, notes=NOTES)


@app.route("/notes")
def notes():
    return jsonify(NOTES)
