# WP-04 acceptance: the doc Markdown on GitHub

Evidence for MILESTONES WP-04 「サンプル文書を GitHub 上で表示し ID コメント不可視・表/fence/alert が崩れない」 (gen spec §10.2,
O8 byte rules).

- `sample.md` — a sample doc written by the DocStore (ts-small static sections + generated prose with cite links,
  nested list, flow sub-section with steps, sequence diagram, why box, module page): 37 block-ID comments.
- `github.html` — the same text rendered by GitHub's own Markdown renderer (REST `POST /markdown`, mode `gfm`).
- `checks.json` — 0 visible ID comments; 4/4 tables, 3/3 fences, 5/5 alerts rendered; cite links intact.
- `github-render.png` — `github.html` with the github-markdown-css light theme (Mermaid fences are shown as code by
  the API; github.com renders them as diagrams).

Regenerate (needs network): `scripts/nd bun packages/doc/src/test/github/render-on-github.ts docs/design/specs/assets/wp04-github`.
