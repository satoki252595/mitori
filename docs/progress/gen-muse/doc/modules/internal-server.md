# レビュー用 HTTP サーバ <!-- b_6qqv0wfb -->

- ファイル 38 · 5799 行 · 重要度 0.43
<!-- b_hhkg50gz -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [CLI 入口と統合管理](cmd-crit.md)・[設定と共有と live 中継](internal-share-config-live.md)
- 使っているもの: [設定と共有と live 中継](internal-share-config-live.md)・[レビューセッション管理](internal-session-session.md)・[版管理抽象と差分取得](internal-vcs.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)・[変更連携基盤](internal-github-gitlab.md)・[コメント管理](internal-comment.md) ほか 2
- テスト: `internal/server/server_test.go`（260 件）・`internal/server/server_agent_test.go`（14 件）・`internal/server/daemon_cli_test.go`（11 件）・`internal/server/round_api_test.go`（10 件） ほか 21 · 実行: `go test ./internal/hooks ./internal/prompt ./internal/server`
- 入口から: `ANY /api/comment/`（`internal/server/server.go:209`）・`ANY /api/review-comment/`（`internal/server/server.go:201`）・`ANY /api/events`（`internal/server/server.go:188`）・`ANY /api/share/upsert-payload`（`internal/server/server.go:180`）・`ANY /api/files/list`（`internal/server/server.go:202`）
- よく使われる宣言（変えると波及する）: `Server` `internal/server/server.go:58`（10 ファイル）・`Session` `internal/server/types.go:11`（8 ファイル）・`Config` `internal/server/types.go:13`（5 ファイル）・`Context` `internal/prompt/context.go:11`（4 ファイル）・`ResolveHookKey` `internal/prompt/hooks.go:36`（4 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: 大きいファイル `internal/server/server.go`（3,508 行）・循環依存（[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[レビューセッション管理](internal-session-session.md) ほか 4 と）
<!-- b_hpy1asac -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `internal/server/server.go`（3,508 行）
  - `internal/server/server.go:40-124` 型（3）: `Server`・`sseHeartbeatInterval`・`AgentScriptFiles`
  - `internal/server/server.go:127-228` 関数: `NewServer`
  - `internal/server/server.go:236-333` メソッド（9）: `ServeHTTP`・`hostForbiddenMessage`・`secFetchSiteForbiddenMessage`・`checkSecFetchSite`
  - `internal/server/server.go:337-479` Server のメソッド（10）: `requireReady`・`withReady`・`SetShutdownCtx`・`SetStopFunc`
  - `internal/server/server.go:481-645` ハンドラ（2）: `handleConfig`・`handleCodeFonts`
  - `internal/server/server.go:648-808` メソッド（9）: `serveEmbeddedJS`・`serveEmbeddedCSS`・`filterFilesAtRound`・`serveIndexHTML`
  - `internal/server/server.go:813-911` ハンドラ（3）: `handleShareConsent`・`handleProjectPromptTrust`・`consentNeeded`
  - `internal/server/server.go:913-1063` ハンドラ（6）: `handleShareURL`・`shareFilesForSession`・`shareCLIArgsForSession`・`previewEntryPath`
  - `internal/server/server.go:1067-1246` ハンドラ（2）: `handleShare`・`handleRounds`
  - `internal/server/server.go:1252-1279` 関数: `lineStatsForRound`
  - `internal/server/server.go:1286-1442` ハンドラ（5）: `handleSharePayload`・`handlePreviewPayload`・`handleUpsertPayload`・`handleSharePull`
  - `internal/server/server.go:1446-1604` メソッド（6）: `softPullForReshare`・`reshareUpsertInputs`・`writeJSONError`・`pullAndMergeRemoteComments`
  - `internal/server/server.go:1609-1717` ハンドラ（2）: `handleMergeComments`・`handleFile`
  - `internal/server/server.go:1725-1835` 関数（3）: `serveFileAtRound`・`handleFileDiff`・`serveFileDiffAtRound`
  - `internal/server/server.go:1846-1988` ハンドラ（4）: `handleFileComments`・`normalizeCommentSide`・`commentRoute`・`routeCommentByID`
  - `internal/server/server.go:1990-2182` ハンドラ（7）: `handleCommentByID`・`handleFileCommentResolve`・`handleFileCommentPut`・`handleFileCommentUpdate`
  - `internal/server/server.go:2185-2245` ハンドラ（2）: `handleReplyCRUD`・`replyOps`
  - `internal/server/server.go:2247-2550` ハンドラ（9）: `handleReplyRoute`・`handleReviewCommentReplyRoute`・`handleReviewComments`・`handleReviewCommentByID`
  - `internal/server/server.go:2554-2654` ハンドラ（10）: `handleShutdown`・`handleHealth`・`shellQuoteArg`・`listUnresolvedComments`
  - `internal/server/server.go:2660-3050` ハンドラ（9）: `handleReviewCycle`・`handleWaitForEvent`・`handleEvents`・`handleAttachments`
  - `internal/server/server.go:3054-3215` ハンドラ（6）: `handleAgentRequest`・`agentName`・`agentRequestBody`・`buildAgentPrompt`
  - `internal/server/server.go:3220-3304` Server のメソッド: `runAgentCmd`
  - `internal/server/server.go:3310-3411` ハンドラ（2）: `handleAuthOrgs`・`handleSharePolicy`
  - `internal/server/server.go:3413-3508` メソッド（9）: `authTokenSnapshot`・`authLoggedIn`・`authUserID`・`authUserName`
<!-- b_xgyy8w59 -->

> [!NOTE]
> **この章で分かること**
> - 要求受付と画面配信の役割分担を学ぶ。
> - 終了時文面とフックの解決手順を学ぶ。
> - 共有と同意判定の入口を学ぶ。 <!-- b_w8x6q1wv -->

## 責務 <!-- b_zmsxg0b3 -->

`Server` はレビュー UI 向けの HTTP 受け口であり、状態不要な経路と `withReady` で守る経路に分けて登録する（[server.go:127-136](../../../internal/server/server.go#L127-L136)、[server.go:170-176](../../../internal/server/server.go#L170-L176)）。`RenderFinish` で終了時文面を作り、`ResolveFinishCommand` と `Run` で外部フックを実行し、`fuzzyScore` で経路絞り込みを助ける（[render.go:134-140](../../../internal/prompt/render.go#L134-L140)、[resolve.go:143-149](../../../internal/hooks/resolve.go#L143-L149)、[run.go:49-55](../../../internal/hooks/run.go#L49-L55)、[server.go:3087-3093](../../../internal/server/server.go#L3087-L3093)）。保存や差分生成の実体は持たず、`Session` の取得・追加呼び出しに委ねる（[types.go:11-12](../../../internal/server/types.go#L11-L12)、[server.go:1859-1860](../../../internal/server/server.go#L1859-L1860)、[server.go:1929-1930](../../../internal/server/server.go#L1929-L1930)）。`consentNeeded` で既定共有の同意要否を判定し、未同意時は送出を止める（[server.go:887-894](../../../internal/server/server.go#L887-L894)）。 <!-- b_g51j5zac -->

## 公開インターフェース <!-- b_29hbsx77 -->

- `NewServer` は振り分け表を組み立て、状態不要な経路と `withReady` 保護経路に分けて登録する（[server.go:127-136](../../../internal/server/server.go#L127-L136)、[server.go:170-176](../../../internal/server/server.go#L170-L176)）。
- `ServeHTTP` はホスト検査と Fetch Site 検査を通した要求だけ振り分け表へ渡す（[server.go:278-293](../../../internal/server/server.go#L278-L293)）。
- `SetSession` は開始印を付けて保持中のセッションを置き換える（[server.go:425-430](../../../internal/server/server.go#L425-L430)）。
- `ResolveDaemonCLIConfig` と `CreateSession` は起動引数の解決とセッション生成を担う（[daemon\_cli.go:244-250](../../../internal/server/daemon_cli.go#L244-L250)、[daemon\_serve.go:12-18](../../../internal/server/daemon_serve.go#L12-L18)）。
- `RenderFinish` と `RenderHook` は終了時と汎用フックの文面を解決して描画する（[render.go:134-142](../../../internal/prompt/render.go#L134-L142)、[render.go:162-172](../../../internal/prompt/render.go#L162-L172)）。
- `ResolveFinishCommand` と `Run` はフック実行文の解決と制限時間付き実行を担う（[resolve.go:143-150](../../../internal/hooks/resolve.go#L143-L150)、[run.go:49-56](../../../internal/hooks/run.go#L49-L56)）。 <!-- b_rrgq6cb5 -->

## 依存関係 <!-- b_pg0vt47a -->

- internal/session には `Session` と `Comment` と `CritJSON` を借り、コメントとラウンド状態を委ねる（[types.go:11-18](../../../internal/server/types.go#L11-L18)）。
- internal/vcs には `GitVCS` を借り、枝と差分の取得を委ねる（[types.go:30-31](../../../internal/server/types.go#L30-L31)）。
- internal/share と internal/config には `ShareScope` と `Config` を借り、公開可否と同意判定に使う（[helpers.go:15-16](../../../internal/server/helpers.go#L15-L16)、[types.go:13-14](../../../internal/server/types.go#L13-L14)）。
- cmd/crit から `DaemonCLIConfig` を受け、設定済み待受として使われる（推測）。 <!-- b_stntd5w9 -->

## データ構造 <!-- b_ss9ymxxa -->

- `Server` は `session` と `mux` と `assets` と `authToken` と `cfg` を持ち、要求処理の共有状態を集める（[server.go:58-66](../../../internal/server/server.go#L58-L66)、[server.go:82-84](../../../internal/server/server.go#L82-L84)）。
- `DaemonCLIConfig` は待受や共有先と `Focus` と `Cfg` を束ね、起動引数の解決結果を表す（[daemon\_cli.go:24-55](../../../internal/server/daemon_cli.go#L24-L55)）。
- `Context` は `ReviewPath` と `UnresolvedCount` と `CommentsJSON` など終了時文面の材料を集める（[context.go:11-24](../../../internal/prompt/context.go#L11-L24)）。
- `ExecutableCommand` は `Kind` と `Arg` と `Hook` と `Source` と `Layer` で実行文の由来を表す（[resolve.go:54-61](../../../internal/hooks/resolve.go#L54-L61)）。
- `TrustState` は `HasProjectPrompts` と `Untrusted` と `UseProject` で企画文面の扱いを表す（[trust.go:148-153](../../../internal/prompt/trust.go#L148-L153)）。 <!-- b_a62b113r -->

## 処理の流れ <!-- b_jzp0s162 -->

1. 呼び出し元は経路付きで投稿し、`handleFileComments` が本体を復号して空文を退ける（[server.go:1846-1884](../../../internal/server/server.go#L1846-L1884)）。
2. `DOMAnchor` 付きは `AddLivePin` へ、行範囲付きは `AddComment` へ振り分けられる（[server.go:1887-1894](../../../internal/server/server.go#L1887-L1894)、[server.go:1929-1930](../../../internal/server/server.go#L1929-L1930)）。
3. 生成物は `Notify` で他タブへ知らせ、作成状態で返される（[server.go:1904-1906](../../../internal/server/server.go#L1904-L1906)）。
4. 取得時は `GetComments` で取り、`commentsAtOrBeforeRound` で丸められる（[server.go:1859-1862](../../../internal/server/server.go#L1859-L1862)）。 <!-- b_kqyqc8dr -->

## テスト <!-- b_bpdz2rpg -->

フック系は `TestFilenames` と `TestLoadCommand_Inline` と `TestResolveFinishCommand_GlobalConfig` で名前解決と読み込みを確かめる（[hooks\_test.go:16](../../../internal/hooks/hooks_test.go#L16)、[hooks\_test.go:29](../../../internal/hooks/hooks_test.go#L29)、[hooks\_test.go:66](../../../internal/hooks/hooks_test.go#L66)）。プロンプト系は `TestLookupPrompt_ModeFallback` と `TestRenderFinish_DefaultUnchanged` で方式別解決と既定描画を確かめる（[prompt\_test.go:13](../../../internal/prompt/prompt_test.go#L13)、[prompt\_test.go:80](../../../internal/prompt/prompt_test.go#L80)）。書体系は `TestEqualAdvances` と `TestCollectCodeFontFamiliesFiltersDeduplicatesAndSorts` で等幅判定と収集を確かめる（[code\_fonts\_test.go:15](../../../internal/server/code_fonts_test.go#L15)、[code\_fonts\_test.go:58](../../../internal/server/code_fonts_test.go#L58)）。 <!-- b_tyz467x0 -->

## 並行性 <!-- b_194tsnfq -->

`Server` は `session` を原子的な入れ物で保持し、`SetSession` と読み取り側で錠なしに交換する（[server.go:58-60](../../../internal/server/server.go#L58-L60)、[server.go:425-430](../../../internal/server/server.go#L425-L430)）。認証と版数と書体一覧は `authMu` と `versionMu` と `codeFontFamiliesMu` で守り、背景処理は `bgWG` で待つ（[server.go:64-65](../../../internal/server/server.go#L64-L65)、[server.go:73-74](../../../internal/server/server.go#L73-L74)、[server.go:108](../../../internal/server/server.go#L108)、[server.go:120-121](../../../internal/server/server.go#L120-L121)）。`shutdownCtx` と `stopDaemon` で停止を伝え、`WaitBackground` で終わりを待つ（[server.go:102-104](../../../internal/server/server.go#L102-L104)、[server.go:399-400](../../../internal/server/server.go#L399-L400)）。 <!-- b_mezvwf94 -->

## 落とし穴 <!-- b_jqp3j61z -->

> [!WARNING]
> **落とし穴**
> - 状態要の経路に `withReady` を付け忘れると未 ready の呼び出しが素通しする（[server.go:170-176](../../../internal/server/server.go#L170-L176)）。
> - `crit-agent.js` だけ `handleCritAgentJS` で配信され、他は `serveEmbeddedJS` のため追加時の分岐を誤りやすい（[server.go:149-154](../../../internal/server/server.go#L149-L154)）。
> - ライブピンは行検証前に分岐し、`Notify` を忘れると他タブへ届かない（[server.go:1886-1894](../../../internal/server/server.go#L1886-L1894)、[server.go:1904-1905](../../../internal/server/server.go#L1904-L1905)）。
> - 同意判定は `configConfigured` で二経路に分かれ、片側のみの変更は見落とされる（[server.go:887-894](../../../internal/server/server.go#L887-L894)）。 <!-- b_t23vg311 -->

> [!TIP]
> **まとめ**
> 受け口と文面解決と共有入口を押さえれば、残りは委譲先の仕様で読める。 <!-- b_w7e3m35r -->
