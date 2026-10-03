# ADR-0012: mitori の git 状態は side repo に置く（ユーザーの repo を増やさない）

- 状態: 採用（2026-10-03、レビュー R1。P0 で決定、WP-08b で実装） / 関連: SEC-05・SEC-07・SEC-08、ADR-0006 R1

## Context
ADR-0006 の初版は snapshot の object、`refs/mitori/*`、worktree の管理情報をユーザーの `.git` に作っていた。security レビューで、(1) untracked の秘密ファイル（credentials.json 等）が snapshot の object になり `refs/mitori/j/*/base` から 30 日到達可能になり、`push --mirror` / `clone --mirror` / `bundle --all` で外へ出る（実証 V9）、(2) global な `git worktree prune` がユーザー自身の worktree の管理情報を消し HEAD と stage を失わせる（実証 V6）、(3) repo-local の filter / merge driver / diff.external が mitori の git 操作で実行される（V3〜V5）ことが示された。

## Decision
1. workspace ごとに `~/.mitori/repos/<ws>/side.git`（bare）を作る。`objects/info/alternates` にユーザーの `<gitdir>/objects`（shadow workspace では shadow.git）を 1 行書く。
2. mitori の git 書き込み（`hash-object -w`、temp index の `add`、`write-tree`、`commit-tree`、`update-ref refs/mitori/*`、`worktree add/remove/prune`）は**すべて** `GIT_DIR=side.git` で行う。ユーザーの HEAD・ref・index・config・object DB・worktree 管理情報は書かない（auto-commit を選んだときの `git commit` だけが例外で、ユーザーの repo に対して明示的に行う）。
3. ユーザーの HEAD・index の読み取りは `GIT_DIR=<user gitdir>` の読み取り専用 call（`rev-parse`、`ls-files -s`、`status --porcelain=v2`）。base commit はユーザーの HEAD を `commit-tree` の parent に使うだけで、object 自体は alternates で見える。
4. git の env は空 + allowlist（`GIT_ENV`）、`GIT_CONFIG_NOSYSTEM=1`・`GIT_ATTR_NOSYSTEM=1`、stdin /dev/null、timeout、`GIT_BASE_ARGS`（hooksPath を空 dir、fsmonitor off、protocol 制限）。diff は `GIT_DIFF_ARGS`（plumbing、`--no-ext-diff --no-textconv`）。
5. side repo の GC: 毎日、終了した job の `refs/mitori/j/*` は 30 日で削除、checkpoint は 30 日、`git -C side.git gc --prune=now` は mitori が dirty object を書いたものだけに作用する。
6. undo 前に `cat-file -e` で必要な object の存在を確認し、ユーザー側の `gc --prune=now` で消えていたら `E_GIT_FAILED (checkpoint_pruned)` と取り消し点の古さを表示する。

## Consequences
- ユーザーの `git branch`・`git for-each-ref`・`git worktree list`・`git count-objects` に mitori の痕跡は出ない（GIT-S-06 で検査）。
- alternates を使うので object のコピーは要らない（dirty file と mitori が作った blob だけ side repo に書かれる）。
- ユーザーが自分の repo で積極的に prune すると古い checkpoint が使えなくなることがある（典型的な undo は数分以内なので影響は小さい。R1-O1 で 30 日の dogfooding 計測）。
- 1 workspace あたり bare repo 1 つ分の disk（dirty blob と job の差分のみ。通常 < 10 MB [仮]）。

## Alternatives
- ユーザーの repo に `refs/mitori/*`（初版）: 上の 3 つの実証済みの問題。
- 毎回 full clone を作る: 時間と disk が大きい（大 repo で数十秒）。
- worktree を使わず temp dir に `git archive`: gate の実行環境として依存 dir の扱いが複雑。worktree は agent mode と typecheck/test のときだけ遅延作成する（ADR-0006 R1-6）。
