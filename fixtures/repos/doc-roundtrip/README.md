# doc-roundtrip

mitori の設計書（`.mitori/doc/*.md`）を読み込んで書き戻したとき、バイトが変わらないことを確かめる 20 文書。
各文書の期待は `roundtrip.json`。`rt-17` と `rt-18` は `edits/` の版に差し替えてから読み込み直す。
`rt-09-long-block.md`（約 100KB の 1 block）は `fixture.json` の generator が作る。
