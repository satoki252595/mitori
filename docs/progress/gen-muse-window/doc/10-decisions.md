# 10. 設計判断 <!-- b_fb031d0f -->

> [!IMPORTANT]
> **単一 `binary` に `frontend` 資産を同梱し `browser` で開く**のが配布の方針である（[AGENTS.md:3](../../AGENTS.md#L3)、[AGENTS.md:11](../../AGENTS.md#L11)）。`cmd/crit/` は薄い `CLI` に留め、中核は `internal/` に置く（[AGENTS.md:9-10](../../AGENTS.md#L9-L10)）。`index.html` は `code-review` と `live-mode` の起動 `fork` に専念する（[AGENTS.md:12](../../AGENTS.md#L12)）。`web/` の資産は `FS` 経由で渡し直配信の仕組みを増やさない（推測）。 <!-- b_pp6nbd6x -->

> [!IMPORTANT]
> **`VCS` の背後に `GitVCS` と `JJVCS` と `SaplingVCS` を置く**のが版管理の方針である（[vcs.go:14-16](../../internal/vcs/vcs.go#L14-L16)、[git\_vcs.go:12-14](../../internal/vcs/git_vcs.go#L12-L14)、[jj.go:22-30](../../internal/vcs/jj.go#L22-L30)、[sapling.go:13-20](../../internal/vcs/sapling.go#L13-L20)）。`hasJJDir` を先に調べるのは同居構成も `.git/` を持つためである（[vcs.go:175-179](../../internal/vcs/vcs.go#L175-L179)）。`hasSLDir` を `git` より先に調べるのは `Sapling` 構成が両方を持つ場合があるためである（[vcs.go:182-186](../../internal/vcs/vcs.go#L182-L186)）。手法を追加する際は `GitVCS` と `JJVCS` と `SaplingVCS` を同時に直す（推測）。 <!-- b_kj3c4rhn -->

> [!IMPORTANT]
> **`DefaultBaseRef` で `origin/<branch>` を優先する**のが既定枝との比較方針である（[vcs.go:43-47](../../internal/vcs/vcs.go#L43-L47)）。`local` の既定枝は `stale` で誤解を招く差分になるため `remote` 参照を優先する（[git.go:148-150](../../internal/vcs/git.go#L148-L150)）。利用者が選んだ上書きは `DefaultBaseRef` でそのまま尊重する（[git.go:152-154](../../internal/vcs/git.go#L152-L154)）。基底選択を変える際は `DefaultBaseRef` と呼出元を確認する（推測）。 <!-- b_whw2zjp0 -->

> [!IMPORTANT]
> **`git` 呼出しは環境継承と促し停止と参照検証で行う**のが実行方針である（[git.go:66-68](../../internal/vcs/git.go#L66-L68)、[git.go:424-428](../../internal/vcs/git.go#L424-L428)）。`os.Environ` に足して `GIT_TERMINAL_PROMPT=0` を付けるのは `GIT_*` を保ち `daemon` での閉塞を防ぐためである（[git.go:66-68](../../internal/vcs/git.go#L66-L68)）。`commitishRe` を `hex` に縛るのは `option-injection` を拒むためである（[git.go:424-425](../../internal/vcs/git.go#L424-L425)）。呼出しを追加する際は環境継承と `commitishRe` 検証を保つ（推測）。 <!-- b_jxg38w0k -->

> [!IMPORTANT]
> **既定枝上は作業木差分で枝上は `merge base` 差分とする**のが `ChangedFiles` の方針である（[git.go:270-274](../../internal/vcs/git.go#L270-L274)）。既定枝上では `staged` と `unstaged` と `untracked` を拾い、枝上では `merge base` 以降と `untracked` を拾う（[git.go:271-272](../../internal/vcs/git.go#L271-L272)）。`resolveSessionStartBaseRef` が `BaseRef` を `HEAD` に固定するのは複数 `round` 審査での一覧消失を防ぐためである（[session.go:779-782](../../internal/session/session.go#L779-L782)）。一覧算出を変える際は `ChangedFilesOnDefaultInDir` の `HEAD` 比較を起点に確認する（推測）。 <!-- b_fsxfmm3a -->

> [!IMPORTANT]
> **欠けた対象は `HasObject` で先に見て縮退する**のが取得失敗の方針である（[vcs.go:124-127](../../internal/vcs/vcs.go#L124-L127)）。`HasObject` で範囲解決前に見るのは描画途中の失敗の代わりに `prompt-fetch` を促すためである（[vcs.go:124-126](../../internal/vcs/vcs.go#L124-L126)）。`ResolveDefaultBranchSHA` の失敗と `bad object` は全体失敗にせず縮退する（[git.go:759-762](../../internal/vcs/git.go#L759-L762)、[git.go:1111-1113](../../internal/vcs/git.go#L1111-L1113)）。取得系を追加する際は `HasObject` 側で欠落を吸収し全体失敗にしない（推測）。 <!-- b_9r97bn5q -->

> [!IMPORTANT]
> **`live-mode*.js` と `crit-*.js` と `crit-agent.js` を分ける**のが画面分割の方針である（[AGENTS.md:14-16](../../AGENTS.md#L14-L16)）。`live-mode*.js` は実況画面の部品に専念する（[AGENTS.md:14](../../AGENTS.md#L14)）。`crit-*.js` は共有描画に専念し、`crit-agent.js` は `iframe` 注入用に保つ（[AGENTS.md:15-16](../../AGENTS.md#L15-L16)）。分けるのは変更影響を閉じるためであり `iframe` 用は本体に混ぜない（推測）。 <!-- b_xwkysfs6 -->

> [!IMPORTANT]
> **`RemoteFiles` が真のとき変更要求の内容読みを `forge API` 経由にする**のが取得切替えの方針である（[session.go:527-528](../../internal/session/session.go#L527-L528)）。既定では `git show <sha>:<path>` を使い `GitLab` の `layer` 差分のみ `API` を使う（[session.go:528-529](../../internal/session/session.go#L528-L529)）。`--remote` で起動時に決めて以後は変えない（[session.go:530](../../internal/session/session.go#L530)）。起動時固定で取得経路を安定させるため追加時は `RemoteFiles` 分岐を保つ（推測）。 <!-- b_d0nnq1zq -->

- まだ決定はありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_bj3rp00s -->
