# ADR-0006: Git 安全モデル

- 状態: 採用（2026-10-03） / 関連: D4、06 §8、synthesis §5.1

## Context
agent にコードを書かせるが、ユーザーの branch・index・working tree は承認まで汚したくない。失敗・中断・取り消しは git だけで完結させたい。dirty tree や untracked ファイルもある。

## Decision
- **snapshot**: 一時 index（`GIT_INDEX_FILE`）で `add -A` → `write-tree` → `commit-tree`（0.29 s）。ユーザーの index は触らない。
- **worktree**: `~/.mitori/wt/<ws>/<job>` に detached worktree（短い path）。大きな repo は `--no-checkout` + sparse。依存 dir は read-only symlink。`claude -p --worktree` は使わない。
- **ref**: `refs/mitori/j/<job>/{base,head}`（branch を作らない、`git branch` に出ない）。accept の checkpoint は `refs/mitori/ck/<ck>`。
- **書き込み範囲の二重検査**: 事前（agent mode は `--allowedTools "Edit(<path>)"`、patch mode は mitori が line-range を原子的に適用）+ 事後（`git diff --name-only base` ⊆ writeScope、deny glob、追加行の secret scan）。違反は worktree ごと破棄。
- **gates**: formatter → typecheck → 関連 test を mitori が実行（trust 済みのみ、argv、env scrub）。失敗抜粋 ≤ 1k token を `--resume` で返して最大 2 回 repair、だめなら agent mode へ昇格。
- **accept（D4）**: `git merge-tree --write-tree` で事前検査（8 ms）→ 選んだ hunk を working tree に **未 commit で適用** → checkpoint。設定で trailer（`Mitori-Thread` / `Mitori-Agent` / `Mitori-Cost`）付き自動 commit。accept は直列キュー（`refs/mitori/integration`）。
- **undo**: checkpoint から復元。accept 後にユーザーが同じファイルを編集していたら `diverged` として残し、`force` でのみ上書き。
- 非 git は shadow repo、GitHub URL は read-only clone で accept = `.patch` 出力。

## Consequences
- 1 task = 1 worktree = 1 hidden ref。並列は WRITE が交差しないものだけ、交差するものは file lock で直列化。
- worktree の掃除（job 終了時 remove + prune、30 日で ref gc）が必須。
- patch mode は「どの行が変わるか」が事前に確定するので、UI で範囲外 edit を機械的に弾ける。

## Alternatives
- ユーザーの branch・index へ直接書く: 取り消しが不確実。
- 別 branch を作る: `git branch` を汚す。user が望むときだけ `mitori/<th>-<slug>` に昇格。
- 自動 commit を既定に: 履歴を汚す。opt-in。
