# 0. ひとことで <!-- b_ya7240m9 -->

Crit は plan と code diff と frontend 成果物を人間向け UI で review する local tool である（[README.md:8](../../README.md#L8)）。markdown 表示と git 変更の diff 表示と起動中 app の proxy 表示を束ね、指摘を agent へ直接返す（[README.md:18-20](../../README.md#L18-L20)）。単一 binary が CLI と HTTP server と browser UI を内蔵する構成である（[README.md:23](../../README.md#L23)、[main.go:21](../../cmd/crit/main.go#L21)、[server.go:136](../../internal/server/server.go#L136)）。 <!-- b_bpc5zvwa -->

- 言語: Go 35,664 行 · JavaScript 20,971 行 · TypeScript 166 行 · Python 137 行
- 規模: 1,219 ファイル · 64,911 行
- 最終 commit: `406875dd31e0`
- ライセンス: MIT
<!-- b_ye2apw2q -->

- 読んだファイル 879 · 除外 340
- 除外の内訳: バイナリ 299 · 除外パターン 16 · テスト用データ 13 · 生成物 1 · ロックファイル 5 · 圧縮済み 3 · 大きすぎるファイル 1 · 特殊ファイル 2
<!-- b_avcqaajn -->
