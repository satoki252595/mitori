# 実 GitHub PR 公開経路の確認（2026-10-05）

利用者の push・merge・不要 branch 削除の承認範囲で、既存 private repo `satoki252595/mitori` に [一時 draft PR #3](https://github.com/satoki252595/mitori/pull/3) を作成した。既存 `pr-local-probe.ts --publish` を用い、製品の `GitSafety.createPullRequest` が private side repo の commit を実際に push し、trusted gh で PR を作ることを確認した。

- base は `815957fd01fb4856b5ae8d3aa2091edd1ddd263f`、公開 commit は `760ecdaec30214c3c8e49a837bca696d1bd39470`。
- 公開差分は新しい `docs/progress/pr-publication-probe.md` の 3 行だけ。GitHub API でも 1 file、3 additions、0 deletions を確認した。コード・個人情報・秘密は含めていない。
- 処理前後の user refs / HEAD / objects / index / local config / worktrees / stash の fingerprint は全て一致。side repo 以外の Git metadata に書かなかった。
- 公開 commit に `Co-Authored-By: Codex <noreply@openai.com>` があることを GitHub の authors / message でも確認した。
- 確認後に PR を close し、remote branch を API で削除。PR state=CLOSED、branch reference=404 を再確認した。検証用の CI run は中止し、変更のない旧 main 全体の重複検証を避けた。

証跡は [pr-native-probe-20261005.json](pr-native-probe-20261005.json)。web-only、passed gates、人の採用済み hunk だけという route 条件は別の integration test で検証した。この probe は export helper の実通信確認であり、実 web UI 上で人が採用する一連の操作を今回再実行した証拠とは扱わない。

```sh
# default は送信を遮断して記録する。実通信は利用者の公開承認がある時だけ。
scripts/nd bun docs/progress/pr-local-probe.ts
MITORI_GITHUB_LIVE=1 scripts/nd bun docs/progress/pr-local-probe.ts --publish
```
