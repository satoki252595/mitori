# CLI 入口と統合管理 <!-- b_8c31dy1p -->

- ファイル 18 · 4901 行 · 重要度 0.28
<!-- b_b14nrcpp -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [レビュー用 HTTP サーバ](internal-server.md)
- 使っているもの: [plan 審査と daemon 管理](internal-session-plan-cli.md)・[変更連携基盤](internal-github-gitlab.md)・[レビュー用 HTTP サーバ](internal-server.md)・[設定と共有と live 中継](internal-share-config-live.md)・[レビューセッション管理](internal-session-session.md)・[版管理抽象と差分取得](internal-vcs.md) ほか 2
- テスト: `cmd/crit/integrations_test.go`（44 件）・`cmd/crit/main_test.go`（39 件）・`cmd/crit/opencode_v2_install_test.go`（25 件）・`cmd/crit/cli_handlers_story_test.go`（22 件） ほか 13 · 実行: `go test ./cmd/crit ./internal/notify ./internal/story`
- 入口から: `crit share`（`cmd/crit/cli_dispatch.go:24`）・`cmd/crit`（`cmd/crit/main.go:21`）・`crit fetch`（`cmd/crit/cli_dispatch.go:36`）・`crit unpublish`（`cmd/crit/cli_dispatch.go:39`）・`crit install`（`cmd/crit/cli_dispatch.go:46`）
- よく使われる宣言（変えると波及する）: `Fingerprint` `internal/story/ingest.go:97`（3 ファイル）・`HunkID` `internal/story/ingest.go:37`（2 ファイル）・`Ingest` `internal/story/ingest.go:56`（2 ファイル）・`Run` `internal/story/ingest.go:115`（2 ファイル）・`FromScope` `internal/story/scope.go:12`（2 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: 循環依存（[変更連携基盤](internal-github-gitlab.md)・[レビューセッション管理](internal-session-session.md)・[レビュー用 HTTP サーバ](internal-server.md) ほか 4 と）
<!-- b_jsx3jr04 -->

> [!NOTE]
> **この章で分かること**
> - 指令の振り分けと引渡し先がわかる
> - 導入物の検査と更新案内がわかる
> - 物語の準備と取込判定がわかる <!-- b_3mrp30gr -->

## 責務 <!-- b_b8m8emw9 -->

命令の玄関であり、`dispatchCLI` が副命令を選び薄い `runShare` で内部へ渡す（[cli\_dispatch.go:216](../../../cmd/crit/cli_dispatch.go#L216)、[cli\_handlers.go:16](../../../cmd/crit/cli_handlers.go#L16)）。導入と鮮度検査は `installIntegration` と `checkInstalledIntegrations` が担う（[cli\_install.go:411](../../../cmd/crit/cli_install.go#L411)、[integrations.go:373](../../../cmd/crit/integrations.go#L373)）。差分取得や保存形式の決定は行わず、内部の処理に委ねる（推測）。 <!-- b_fndy9p29 -->

## 公開インターフェース <!-- b_pgy8ev1b -->

- `Run` は取込検査を行い保存可否と被覆を返す（[ingest.go:115-125](../../../internal/story/ingest.go#L115-L125)）。
- `Fingerprint` は列から指紋文字列を作る（[ingest.go:97](../../../internal/story/ingest.go#L97)）。
- `BuildPrep` は差分入力を下書き文へ整える（[prep.go:51](../../../internal/story/prep.go#L51)）。
- `FromScope` は域を準備入力と列へ分ける（[scope.go:12](../../../internal/story/scope.go#L12)）。
- `BuildStoryPrompt` は案内と図式から指示文を組む（[prompt.go:17](../../../internal/story/prompt.go#L17)）。
- `RoundReady` と `Desktop` は完了を知らせる（[notify.go:20](../../../internal/notify/notify.go#L20)、[notify.go:25](../../../internal/notify/notify.go#L25)）。 <!-- b_aqmzb1d1 -->

## 依存関係 <!-- b_3zmt5jrf -->

- 審査や計画は internal/session の `RunReview` と `RunPlan` に渡す（[cli\_handlers.go:24-26](../../../cmd/crit/cli_handlers.go#L24-L26)）。
- 共有と設定は internal の `RunShare` と `RunConfig` に渡す（[cli\_handlers.go:16-19](../../../cmd/crit/cli_handlers.go#L16-L19)）。
- 位置引数は `routePositionalArgs` が用途別に振り分ける（[cli\_routing.go:27](../../../cmd/crit/cli_routing.go#L27)）。
- 起動後の振舞いは internal/server 側からも参照される（推測）。 <!-- b_1xtr8dqr -->

## データ構造 <!-- b_wya65bxp -->

- `commandDescriptor` は名前と処理と助言を持ち階層化できる（[cli\_dispatch.go:11-18](../../../cmd/crit/cli_dispatch.go#L11-L18)）。
- `integration` は導入元と配置先と表示助言を持つ（[cli\_install.go:143-146](../../../cmd/crit/cli_install.go#L143-L146)）。
- `staleFile` は古い導入物の場所と期待ハッシュを持つ（[integrations.go:151-156](../../../cmd/crit/integrations.go#L151-L156)）。
- `Ingest` は物語と対象列と実測指紋を束ねる（[ingest.go:56](../../../internal/story/ingest.go#L56)、[ingest.go:59](../../../internal/story/ingest.go#L59)、[ingest.go:63](../../../internal/story/ingest.go#L63)、[ingest.go:73](../../../internal/story/ingest.go#L73)）。
- `storyFlags` は物語用の旗と残りの域引数を束ねる（[cli\_handlers\_story.go:32-40](../../../cmd/crit/cli_handlers_story.go#L32-L40)、[cli\_handlers\_story.go:43](../../../cmd/crit/cli_handlers_story.go#L43)）。 <!-- b_xxtyrnwq -->

## 処理の流れ <!-- b_kwmxckcw -->

1. `main` が資産を結び付けて起動する（[main.go:12-13](../../../cmd/crit/main.go#L12-L13)、[main.go:21](../../../cmd/crit/main.go#L21)）。
2. `dispatchCLI` が登録から副命令を探す（[cli\_dispatch.go:216](../../../cmd/crit/cli_dispatch.go#L216)）。
3. 位置引数は `routePositionalArgs` が用途へ振る（[cli\_routing.go:27](../../../cmd/crit/cli_routing.go#L27)）。
4. 薄い `runReview` が内部へ引き渡す（[cli\_handlers.go:24](../../../cmd/crit/cli_handlers.go#L24)）。 <!-- b_q0keb5rv -->

## 設定 <!-- b_ryesagsf -->

- `storyFlags` は `--story-file` や `--prep` を受ける（[cli\_handlers\_story.go:32-34](../../../cmd/crit/cli_handlers_story.go#L32-L34)）。
- `CODEX_HOME` は配置先決定に使う（[cli\_install.go:1091](../../../cmd/crit/cli_install.go#L1091)）。
- `CRIT_NO_INTEGRATION_CHECK` と `CRIT_NO_UPDATE_CHECK` は検査を抑止する（[cli\_serve.go:47](../../../cmd/crit/cli_serve.go#L47)、[cli\_serve.go:283](../../../cmd/crit/cli_serve.go#L283)）。 <!-- b_64pp3akw -->

## テスト <!-- b_h25jdgtn -->

合併処理は空文書と既存鍵保持と冪等を確かめる（[aider\_install\_test.go:41](../../../cmd/crit/aider_install_test.go#L41)、[aider\_install\_test.go:56](../../../cmd/crit/aider_install_test.go#L56)、[aider\_install\_test.go:82](../../../cmd/crit/aider_install_test.go#L82)）。分配表は公開一覧と不変条件と非実行を確かめる（[cli\_dispatch\_test.go:17](../../../cmd/crit/cli_dispatch_test.go#L17)、[cli\_dispatch\_test.go:24](../../../cmd/crit/cli_dispatch_test.go#L24)、[cli\_dispatch\_test.go:45](../../../cmd/crit/cli_dispatch_test.go#L45)）。位置引数は種別判定と外部変更の書換えを確かめる（[cli\_routing\_test.go:9](../../../cmd/crit/cli_routing_test.go#L9)、[cli\_routing\_test.go:73](../../../cmd/crit/cli_routing_test.go#L73)、[cli\_routing\_test.go:98](../../../cmd/crit/cli_routing_test.go#L98)）。物語鍵の不変条件と提供前検査を確かめる（[cli\_handlers\_story\_test.go:74](../../../cmd/crit/cli_handlers_story_test.go#L74)、[cli\_handlers\_story\_test.go:83](../../../cmd/crit/cli_handlers_story_test.go#L83)、[cli\_serve\_test.go:17](../../../cmd/crit/cli_serve_test.go#L17)、[cli\_serve\_test.go:54](../../../cmd/crit/cli_serve_test.go#L54)）。 <!-- b_hppxx6xn -->

## 不変条件 <!-- b_h5a54fmb -->

- 指紋の不一致は保存せず跳ね返す（[ingest.go:122-126](../../../internal/story/ingest.go#L122-L126)）。
- 重複配置は厳密に拒否する（[ingest.go:142-146](../../../internal/story/ingest.go#L142-L146)）。
- 床を割る配置率は自動修復しない（[ingest.go:156-160](../../../internal/story/ingest.go#L156-L160)）。 <!-- b_0488cef2 -->

## エラー処理 <!-- b_r3jzkgmp -->

- 形の不正は被覆付きで返す（[ingest.go:117-120](../../../internal/story/ingest.go#L117-L120)）。
- 取込失敗は漂動と重複と床割れで区別する（[ingest.go:122-126](../../../internal/story/ingest.go#L122-L126)、[ingest.go:142-146](../../../internal/story/ingest.go#L142-L146)、[ingest.go:156-160](../../../internal/story/ingest.go#L156-L160)）。
- 検査系は誤出力へ書いて終止する（[integrations.go:708-718](../../../cmd/crit/integrations.go#L708-L718)）。 <!-- b_nfrzb6af -->

## 落とし穴 <!-- b_j48y22r2 -->

> [!WARNING]
> **落とし穴**
> - `prePlaceIgnored` を後回しにすると欠落扱いがずれる（[ingest.go:133-139](../../../internal/story/ingest.go#L133-L139)）。
> - `integrationHashes` は生成用の `main` と対で更新する（[integrations.go:224](../../../cmd/crit/integrations.go#L224)、[gen\_integration\_hashes.go:16](../../../cmd/crit/gen_integration_hashes.go#L16)）。
> - `storyFlags` の未処理分は `buildStoryScope` へ渡される（[cli\_handlers\_story.go:32-40](../../../cmd/crit/cli_handlers_story.go#L32-L40)、[cli\_handlers\_story.go:43](../../../cmd/crit/cli_handlers_story.go#L43)、[cli\_handlers\_story.go:312](../../../cmd/crit/cli_handlers_story.go#L312)）。 <!-- b_gaqma3mp -->

> [!TIP]
> **まとめ**
> 出入口と導入検査と物語受付を受け持ち、実処理は内部へ渡す構成だ。 <!-- b_0prfcf9z -->
