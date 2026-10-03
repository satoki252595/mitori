# ADR-0006: Git 安全モデル

- 状態: 採用（2026-10-03） / 関連: D4、06 §8、synthesis §5.1

## Context
agent にコードを書かせるが、ユーザーの branch・index・working tree は承認まで汚したくない。失敗・中断・取り消しは git だけで完結させたい。dirty tree や untracked ファイルもある。

## Decision
- **snapshot**: 一時 index（`GIT_INDEX_FILE`）で `add -A` → `write-tree` → `commit-tree`（0.29 s）。ユーザーの index は触らない。
- **worktree**: `~/.mitori/wt/<ws>/<job>` に detached worktree（短い path）。大きな repo は `--no-checkout` + sparse。依存 dir は read-only symlink。`claude -p --worktree` は使わない。
- **ref**: `refs/mitori/j/<job>/{base,head}`（branch を作らない、`git branch` に出ない。R1-1: すべて side repo に置く）。accept の checkpoint は `refs/mitori/ck/<ck>`。
- **書き込み範囲の二重検査**: 事前（agent mode は `--allowedTools "Edit(<path>)"`（R1-3: 絶対形 `Edit(//<abs>)` のみ）、patch mode は mitori が line-range を原子的に適用）+ 事後（`git diff --name-only base` ⊆ writeScope、deny glob、追加行の secret scan）。違反は worktree ごと破棄。
- **gates**: formatter → typecheck → 関連 test を mitori が実行（trust 済みのみ、argv、env scrub）。失敗抜粋 ≤ 1k token を ~~`--resume` で返して~~（R1-5 で置換: continuation → resume（persistSessions のみ）→ cold）最大 2 回 repair、だめなら agent mode へ昇格。
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

## 改訂 R1（2026-10-03、レビュー反映） — 本節が上の Decision より優先

1. **side repo（SEC-07・SEC-08、ADR-0012）**: snapshot・ref（`refs/mitori/*`）・worktree・mitori が作る object はすべて `~/.mitori/repos/<ws>/side.git`（`objects/info/alternates` → ユーザーの object DB）に置く。ユーザーの repo には ref・object・worktree メタが一切増えない。prune は side.git の中だけ。
2. **snapshot の除外（SEC-07・SEC-18）**: untracked のうち `SECRET_PATH_GLOBS` に当たるものと、内容の secret scan で hit したものは入れない。filter / working-tree-encoding 属性と LFS pointer の path は write scope にしない。
3. **書き込み範囲（SEC-09）**: agent mode の事前検査は **絶対形** `Edit(//<abs worktree>/<RepoPath>)` だけ（相対形は別階層の同名ファイルにも当たる）。path は `AGENT_PATH_ALLOWED_RE`（allowlist）で検査。事後検査は `git diff-tree --name-only`（plumbing）。
4. **diff と git 環境（SEC-05）**: diff は `git diff-tree -p … --no-ext-diff --no-textconv`（`GIT_DIFF_ARGS`）。secret scan の追加行は blob から Myers で計算し diff 文字列を解析しない。git の env は空 + allowlist（親の `GIT_*` を継承しない、`GIT_CONFIG_NOSYSTEM=1`、`GIT_ATTR_NOSYSTEM=1`、stdin /dev/null、timeout）。repo-local config の命令系キー（filter/merge driver、diff.external …）は trust（`git_config`）まで `-c key=` で無効化。
5. **gates（ADR-0013）**: 実行は sandbox か人の同意の後。修復の経路は「**parking 中のプロセスへの continuation → resume（`persistSessions` のときだけ）→ cold 再実行**」の 3 段（CONS-15）。上の「`--resume` で返して」は無効。
6. **head tree（PT-19）**: patch mode の head は in-memory（`hash-object -w` + `update-index --cacheinfo` + `write-tree`）で作り、format gate は変更ファイルの temp コピーで実行。完全な worktree は trusted な typecheck/test gate か agent mode のときだけ遅延作成。
7. **部分 accept（CONS-18・UXP-05）**: hunk ごとに accepted / rejected / pending。選択で head と違う木 H′ になるときは同じ gate を H′ で再実行してから適用（失敗なら明示の「検査に失敗した組み合わせを採用」）。
8. **undo（SEC-18）**: 強制 undo の直前に現状を `refs/mitori/ck/<ck>-pre-force` に保存。rename 直前の内容は side repo へ `hash-object -w` して journal に記録。alternates 先で object が prune されていたら `E_GIT_FAILED (checkpoint_pruned)`。
