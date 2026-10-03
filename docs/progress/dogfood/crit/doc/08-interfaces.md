# 8. 外部インターフェース <!-- b_hepc2b65 -->

| メソッド | パス | ハンドラ | 定義 |
|---|---|---|---|
| ANY | `/` | — | `internal/server/server.go:224` |
| ANY | `/agent-marker.css` | — | `internal/server/server.go:156` |
| ANY | `/api/agent/request` | `internal/server/server.go#Server.handleAgentRequest` | `internal/server/server.go:196` |
| ANY | `/api/attachments` | `internal/server/server.go#Server.handleAttachments` | `internal/server/server.go:218` |
| ANY | `/api/attachments/` | `internal/server/server.go#Server.handleAttachments` | `internal/server/server.go:219` |
| ANY | `/api/auth/orgs` | `internal/server/server.go#Server.handleAuthOrgs` | `internal/server/server.go:195` |
| ANY | `/api/base-branch` | `internal/server/server.go#Server.handleBaseBranch` | `internal/server/server.go:198` |
| ANY | `/api/branches` | `internal/server/server.go#Server.handleBranches` | `internal/server/server.go:197` |
| ANY | `/api/code-fonts` | `internal/server/server.go#Server.handleCodeFonts` | `internal/server/server.go:173` |
| ANY | `/api/comment/` | `internal/server/server.go#Server.handleCommentByID` | `internal/server/server.go:209` |
| ANY | `/api/comments` | `internal/server/server.go#Server.handleReviewComments` | `internal/server/server.go:200` |
| ANY | `/api/comments/merge` | `internal/server/server.go#Server.handleMergeComments` | `internal/server/server.go:185` |
| ANY | `/api/commits` | `internal/server/server.go#Server.handleCommits` | `internal/server/server.go:199` |
| ANY | `/api/config` | `internal/server/server.go#Server.handleConfig` | `internal/server/server.go:172` |
| ANY | `/api/events` | `internal/server/server.go#Server.handleEvents` | `internal/server/server.go:188` |
| ANY | `/api/file` | `internal/server/server.go#Server.handleFile` | `internal/server/server.go:206` |
| ANY | `/api/file/comments` | `internal/server/server.go#Server.handleFileComments` | `internal/server/server.go:208` |
| ANY | `/api/file/diff` | `internal/server/server.go#Server.handleFileDiff` | `internal/server/server.go:207` |
| ANY | `/api/files/list` | `internal/server/server.go#Server.handleFilesList` | `internal/server/server.go:202` |
| ANY | `/api/finish` | `internal/server/server.go#Server.handleFinish` | `internal/server/server.go:186` |
| ANY | `/api/focus` | `internal/server/server.go#Server.handleFocus` | `internal/server/server.go:192` |
| ANY | `/api/health` | `internal/server/server.go#Server.handleHealth` | `internal/server/server.go:136` |
| ANY | `/api/picker` | `internal/server/picker.go#Server.handlePicker` | `internal/server/server.go:193` |
| ANY | `/api/project-prompts/trust` | `internal/server/server.go#Server.handleProjectPromptTrust` | `internal/server/server.go:177` |
| ANY | `/api/qr` | `internal/server/server.go#Server.handleQR` | `internal/server/server.go:137` |
| ANY | `/api/review-comment/` | `internal/server/server.go#Server.handleReviewCommentByID` | `internal/server/server.go:201` |
| ANY | `/api/review-cycle` | `internal/server/server.go#Server.handleReviewCycle` | `internal/server/server.go:171` |
| ANY | `/api/round-complete` | `internal/server/server.go#Server.handleRoundComplete` | `internal/server/server.go:190` |
| ANY | `/api/rounds` | `internal/server/server.go#Server.handleRounds` | `internal/server/server.go:191` |
| ANY | `/api/session` | `internal/server/server.go#Server.handleSession` | `internal/server/server.go:174` |
| ANY | `/api/share` | `internal/server/server.go#Server.handleShare` | `internal/server/server.go:175` |
| ANY | `/api/share-consent` | `internal/server/server.go#Server.handleShareConsent` | `internal/server/server.go:176` |
| ANY | `/api/share-policy` | `internal/server/server.go#Server.handleSharePolicy` | `internal/server/server.go:183` |
| ANY | `/api/share-url` | `internal/server/server.go#Server.handleShareURL` | `internal/server/server.go:184` |
| ANY | `/api/share/payload` | `internal/server/server.go#Server.handleSharePayload` | `internal/server/server.go:178` |
| ANY | `/api/share/preview-payload` | `internal/server/server.go#Server.handlePreviewPayload` | `internal/server/server.go:179` |
| ANY | `/api/share/pull` | `internal/server/server.go#Server.handleSharePull` | `internal/server/server.go:181` |
| ANY | `/api/share/reshare` | `internal/server/server.go#Server.handleShareReshare` | `internal/server/server.go:182` |
| ANY | `/api/share/upsert-payload` | `internal/server/server.go#Server.handleUpsertPayload` | `internal/server/server.go:180` |
| ANY | `/api/shutdown` | `internal/server/server.go#Server.handleShutdown` | `internal/server/server.go:187` |
| ANY | `/api/story` | `internal/server/server_story.go#Server.handleStory` | `internal/server/server.go:203` |
| ANY | `/api/wait-for-event` | `internal/server/server.go#Server.handleWaitForEvent` | `internal/server/server.go:189` |
| ANY | `/crit-settings-panes.js` | — | `internal/server/server.go:168` |
| ANY | `/files/` | `internal/server/server.go#Server.handleFiles` | `internal/server/server.go:222` |
| ANY | `/live` | — | `internal/server/server.go:148` |
| ANY | `/live-mode-deeplink.js` | — | `internal/server/server.go:164` |
| ANY | `/live-mode-drift-tray.js` | — | `internal/server/server.go:159` |
| ANY | `/live-mode-pin-filter.js` | — | `internal/server/server.go:157` |
| ANY | `/live-mode-pin-state.js` | — | `internal/server/server.go:160` |
| ANY | `/live-mode-reanchor-click.js` | — | `internal/server/server.go:162` |
| ANY | `/live-mode-reanchor-put.js` | — | `internal/server/server.go:163` |
| ANY | `/live-mode-resolution-gate.js` | — | `internal/server/server.go:158` |
| ANY | `/live-mode-round-resolve.js` | — | `internal/server/server.go:165` |
| ANY | `/live-mode-round-tooltip.js` | — | `internal/server/server.go:166` |
| ANY | `/live-mode-thread-scroll.js` | — | `internal/server/server.go:161` |
| ANY | `/live-mode.menu-controller.js` | — | `internal/server/server.go:167` |
| ANY | `/preview` | — | `internal/server/server.go:140` |
| ANY | `/preview-content` | `internal/server/preview_handlers.go#Server.handlePreviewContent` | `internal/server/server.go:142` |
| ANY | `/preview-content/` | `internal/server/preview_handlers.go#Server.handlePreviewContent` | `internal/server/server.go:141` |
| ANY | `/themes` | — | `internal/server/server.go:145` |
| ANY | `/{…}` | `internal/server/server.go#Server.handleCritAgentJS` | `internal/server/server.go:151` |
| ANY | `/{…}` | — | `internal/server/server.go:153` |
<!-- b_av20andt -->

| コマンド | フラグ | 定義 |
|---|---|---|
| `crit _serve` | — | `cmd/crit/cli_dispatch.go:211` |
| `crit auth` | — | `cmd/crit/cli_dispatch.go:155` |
| `crit cleanup` | — | `cmd/crit/cli_dispatch.go:205` |
| `crit comment` | — | `cmd/crit/cli_dispatch.go:70` |
| `crit comments` | — | `cmd/crit/cli_dispatch.go:90` |
| `crit config` | — | `cmd/crit/cli_dispatch.go:47` |
| `crit fetch` | — | `cmd/crit/cli_dispatch.go:36` |
| `crit install` | — | `cmd/crit/cli_dispatch.go:46` |
| `crit live` | — | `cmd/crit/cli_dispatch.go:104` |
| `crit mr` | — | `cmd/crit/cli_dispatch.go:54` |
| `crit plan` | — | `cmd/crit/cli_dispatch.go:134` |
| `crit plan-hook` | — | `cmd/crit/cli_dispatch.go:208` |
| `crit pr` | — | `cmd/crit/cli_dispatch.go:51` |
| `crit preview` | — | `cmd/crit/cli_dispatch.go:120` |
| `crit pull` | — | `cmd/crit/cli_dispatch.go:57` |
| `crit push` | — | `cmd/crit/cli_dispatch.go:60` |
| `crit resume` | — | `cmd/crit/cli_dispatch.go:189` |
| `crit review` | — | `cmd/crit/cli_dispatch.go:93` |
| `crit share` | — | `cmd/crit/cli_dispatch.go:24` |
| `crit stats` | — | `cmd/crit/cli_dispatch.go:202` |
| `crit status` | — | `cmd/crit/cli_dispatch.go:186` |
| `crit stop` | — | `cmd/crit/cli_dispatch.go:182` |
| `crit story` | — | `cmd/crit/cli_dispatch.go:154` |
| `crit unpublish` | — | `cmd/crit/cli_dispatch.go:39` |
<!-- b_ybdgqxne -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `BRIDGE_PORT` | なし | `integrations/docker/Dockerfile:24` |
| `CODEX_HOME` | なし | `cmd/crit/cli_install.go:1091` `internal/testutil/testutil.go:111` |
| `CRIT_AUTH_TOKEN` | なし | `internal/auth/auth.go:368` `internal/auth/auth.go:645` `internal/config/share_targets.go:230` `internal/server/share_targets.go:123` `internal/share/share.go:1132` |
| `CRIT_DEBUG` | なし | `internal/session/session.go:2510` |
| `CRIT_HOST` | なし | `internal/config/cli_resolve.go:64` |
| `CRIT_NO_INTEGRATION_CHECK` | なし | `cmd/crit/cli_serve.go:47` `cmd/crit/integrations.go:684` `internal/session/daemon_cli.go:57` |
| `CRIT_NO_UPDATE_CHECK` | なし | `cmd/crit/cli_serve.go:283` |
| `CRIT_PLAN_REVIEW` | なし | `internal/session/plan_cli.go:355` |
| `CRIT_PORT` | なし | `integrations/docker/Dockerfile:24` `internal/config/cli_resolve.go:51` `internal/server/daemon_cli.go:409` |
| `CRIT_PUBLIC_URL` | なし | `internal/config/public_url.go:17` |
| `CRIT_SHARE_URL` | なし | `internal/config/cli_resolve.go:75` `internal/config/share_targets.go:198` `internal/server/daemon_cli.go:194` `internal/server/daemon_cli.go:198` `internal/server/daemon_cli.go:277` `internal/share/share.go:1096` |
| `GOBIN` | なし | `internal/server/install_source.go:31` |
| `GOPATH` | なし | `internal/server/install_source.go:31` |
| `HOME` | なし | `internal/testutil/testutil.go:109` |
| `USERPROFILE` | なし | `internal/testutil/testutil.go:110` |
| `WSL_DISTRO_NAME` | なし | `internal/browser/browser.go:105` |
| `WSL_INTEROP` | なし | `internal/browser/browser.go:105` |
| `_CRIT_READY_STDOUT` | なし | `internal/daemon/daemon.go:940` `internal/daemon/daemon.go:943` |
<!-- b_nmh5jjsk -->
