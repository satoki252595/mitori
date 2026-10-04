# crit CLI 本体 <!-- b_xhzdtfr2 -->

- ファイル 18 · 4901 行 · 重要度 0.28
<!-- b_aprs6cs7 -->

> [!NOTE]
> **この章で分かること**
> - `crit` コマンドの入口とサブコマンド登録の仕組み
> - 連携（integration）のインストールと古さの検出
> - story の取り込み検証（カバレッジ判定） <!-- b_yax0v78c -->

## 責務 <!-- b_3fb51p9p -->

`cmd/crit` は `crit` バイナリの `main` パッケージであり、サブコマンドの振り分け、エージェント連携のインストールと検査、story 機能の CLI を受け持つ（[cli\_dispatch.go:3-15](../../../cmd/crit/cli_dispatch.go#L3-L15)）。各サブコマンドの実処理は `internal` 側のパッケージに任せ、ここでは `clicmd.Exit` で包んで呼ぶだけである（[cli\_handlers.go:15-30](../../../cmd/crit/cli_handlers.go#L15-L30)）。`internal/story` は story の検証・取り込みを、`internal/notify` はデスクトップ通知を担う（[ingest.go:115-120](../../../internal/story/ingest.go#L115-L120)）。 <!-- b_9b84hbvc -->

## 公開インターフェース <!-- b_t76j85qv -->

- `commandRegistry`: `commandDescriptor` の一覧で、名前・ハンドラ・ヘルプ・hidden・サブコマンドを持つ（[cli\_dispatch.go:11-23](../../../cmd/crit/cli_dispatch.go#L11-L23)）。
- `dispatchWithRegistry`: 引数からコマンドを探して実行する（[cli\_dispatch.go:220](../../../cmd/crit/cli_dispatch.go#L220)）。
- `routePositionalArgs`: 位置引数を review・変更レビュー・live・preview のどれかに振り分ける（推測）。
- `story.Run`: story を検証し、カバレッジを計算して保存可否を返す（[ingest.go:115-171](../../../internal/story/ingest.go#L115-L171)）。
- `notify.RoundReady`: ラウンド準備完了を通知する（[notify.go:20](../../../internal/notify/notify.go#L20)）。 <!-- b_719rwmkr -->

## 処理の流れ <!-- b_mr5cvy9k -->

1. `normalizeStory` と `ValidateShape` で形を検査する（[ingest.go:117-120](../../../internal/story/ingest.go#L117-L120)）。
2. `ScopeFingerprint` が `LiveFingerprint` と違えば `ErrDrift` で拒否する（[ingest.go:123-126](../../../internal/story/ingest.go#L123-L126)）。
3. ignored を support に先置きし、重複があれば `ErrDuplicate` で拒否する（[ingest.go:135-146](../../../internal/story/ingest.go#L135-L146)）。
4. 未配置のハンクがあり、配置率が `placedFloor` 未満なら `ErrBelowFloor` を返す（[ingest.go:157-161](../../../internal/story/ingest.go#L157-L161)）。
5. それ以外は `auto-repaired` で補完し、修復なしの時だけ `coverage.OK` が真になる（[ingest.go:162-168](../../../internal/story/ingest.go#L162-L168)）。 <!-- b_zekdq6dm -->

## 設定 <!-- b_yg51kcks -->

- `CRIT_NO_INTEGRATION_CHECK`: 連携チェックの抑止に使う（[cli\_serve.go:47](../../../cmd/crit/cli_serve.go#L47)）。
- `CRIT_NO_UPDATE_CHECK`: 更新チェックの抑止に使う（[cli\_serve.go:283](../../../cmd/crit/cli_serve.go#L283)）。
- `CODEX_HOME`: Codex のホーム解決で読む（[cli\_install.go:1091](../../../cmd/crit/cli_install.go#L1091)）。 <!-- b_h1hrwj9p -->

## テスト <!-- b_cyh8eabf -->

レジストリの一覧と不変条件、`--help` がハンドラを呼ばないことをテストしている（[cli\_dispatch\_test.go:17](../../../cmd/crit/cli_dispatch_test.go#L17)、[cli\_dispatch\_test.go:24](../../../cmd/crit/cli_dispatch_test.go#L24)、[cli\_dispatch\_test.go:45](../../../cmd/crit/cli_dispatch_test.go#L45)）。位置引数のルーティングは PR URL や live URL を含めて検証される（[cli\_routing\_test.go:9](../../../cmd/crit/cli_routing_test.go#L9)、[cli\_routing\_test.go:73](../../../cmd/crit/cli_routing_test.go#L73)、[cli\_routing\_test.go:115](../../../cmd/crit/cli_routing_test.go#L115)）。story のセッションキーは git・range・PR・MR で不変であることも確認する（[cli\_handlers\_story\_test.go:74](../../../cmd/crit/cli_handlers_story_test.go#L74)、[cli\_handlers\_story\_test.go:83](../../../cmd/crit/cli_handlers_story_test.go#L83)、[cli\_handlers\_story\_test.go:97](../../../cmd/crit/cli_handlers_story_test.go#L97)、[cli\_handlers\_story\_test.go:114](../../../cmd/crit/cli_handlers_story_test.go#L114)）。 <!-- b_p83j1veb -->

## 落とし穴 <!-- b_gb99jfw7 -->

> [!WARNING]
> **落とし穴**
> - `checkInstalledIntegrations` と `detectInstalledIntegrations` は同じ走査を別々に書いており、変更は両方に要る（[integrations.go:208-259](../../../cmd/crit/integrations.go#L208-L259)、[integrations.go:373-413](../../../cmd/crit/integrations.go#L373-L413)）。
> - 古さ判定は `integrationHashes` との内容ハッシュ比較なので、連携ファイルを変えたら `gen_integration_hashes.go` の再生成が要る（[integrations.go:224-238](../../../cmd/crit/integrations.go#L224-L238)）。 <!-- b_rjqqwm8v -->

> [!TIP]
> **まとめ**
> `cmd/crit` は CLI の入口と連携管理を持ち、story の検証は `internal/story` が行う。 <!-- b_vnchkpz7 -->
