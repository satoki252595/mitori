# ADR-0014: すべてのファイル書き込みは SafeWriter を通す

- 状態: 採用（2026-10-03、レビュー R1。WP-01 で実装、全 WP が使用） / 関連: SEC-01・SEC-02・SEC-21、ADR-0004 R1

## Context
doc の書き出しは repo 由来の path と symlink を信頼していた。commit 済みの symlink `.mitori -> ../../../../.claude` は clone 後も残り、`mitori https://github.com/evil/repo` で開くだけで静的 flush が `~/.claude/` に README.md・config.json・doc/*.md を書いた（実証 V7）。`doc.index.json` の seed や repo 設定の slug `../../../../.claude/CLAUDE` は `~/.claude/CLAUDE.md` を上書きした（V8）。これは以後のすべての Claude Code セッションに永続的な指示を植える。同じ型の穴が `SectionNode.file`、docDir override、symlink された AGENTS.md/CLAUDE.md/.gitattributes にある。

## Decision
1. core に `SafeWriter { write(rootReal, rel, bytes, kind); remove(...) }` と `SafeWriteKind`（doc / prep / integration / repo_meta / accept / home）。platform が唯一の実装を持ち、`writeFile`・`rename`・`mkdir` の直接使用は lint で禁止（platform 内部を除く）。
2. 手順: (1) `rel` が kind の allowlist 正規表現に一致し、`..`・絶対 path・NUL・`\` を含まない、(2) `rootReal`（それ自体 realpath）から各 component を `lstat` し、symlink があれば `E_PATH_SYMLINK`、(3) 親の realpath が `rootReal` 配下でなければ `E_PATH_OUTSIDE`、(4) 同じ dir に `O_CREAT|O_EXCL|O_NOFOLLOW` で temp を作り write + fsync、(5) rename の直前に target を `lstat`（symlink なら拒否）、(6) rename、dir を fsync。dir も 1 段ずつ同じ検査で作る。
3. kind ごとの allowlist: `doc` = DOC_TEMPLATE のファイル、`doc/modules/<SLUG_RE>.md`、`decisions/dc_<id>.md`、`mitori.json`、`doc.index.json`、`config.json`、`README.md`、`.gitignore`、`cache/**`。`prep` = `tmp/prep/pr_<id>/**`。`integration` = installer の固定相対 path。`repo_meta` = `.gitattributes`・`AGENTS.md`・`CLAUDE.md`（managed block のみ。symlink は realpath が repo 内のときだけ追従）。`accept` = job の write scope の RepoPath。`home` = `~/.mitori/**`。
4. slug はどの経路（導出・repo 設定・seed）でも `SLUG_RE` を検証し、不正なら再 slug 化して `notice.slug.rewritten`。永続化された `file` は使わず毎回再計算。docDir override は realpath(root) 配下・symlink component なし・`..` なし・root そのものは不可。
5. export は daemon が書かず HTML を返し CLI が書く（CONS-07）。hook / MCP の登録は mitori の realpath を埋め込む（SEC-21）。

## Consequences
- remote-readonly の clone を含め、書き込み spy で root と `~/.mitori/repos/<ws>` 以外への書き込みが 0 バイトであることを RT-25〜29 で検査する。
- 正規の symlink 運用（docDir を symlink で別の場所に置く）はできなくなる。必要なら workspace override で実体 path を指定する。
- 書き込みは 1 回あたり component 数ぶんの lstat が増える（数十 µs、flush 予算 5 ms に対して無視できる）。

## Alternatives
- realpath の確認だけ: TOCTOU（確認と rename の間の symlink 差し替え）に弱い。
- chroot / sandbox で daemon を動かす: 移植性と実装コストが大きい。
