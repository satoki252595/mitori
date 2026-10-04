# レビュー中核処理 <!-- b_1vq1etej -->

- ファイル 0 · 31035 行 · 重要度 1.00
- 子モジュール 7
<!-- b_2p33tdga -->

> [!NOTE]
> **この章で分かること**
> - internal は crit の Go 実装の中核で、7 つの子モジュールに分かれている。
> - VCS 抽象化とセッション管理が土台になり、その上に CLI、HTTP サーバー、forge 同期が載る。
> - 読む順序は vcs、session、server が分かりやすい。 <!-- b_hgycsdzf -->

## 責務 <!-- b_2h0tp3zp -->

internal は、レビュー対象の解決、コメントとラウンドの保持、永続化、ローカル HTTP サーバー、GitHub・GitLab との同期をまとめたグループである。バージョン管理の差異は `VCS` インターフェースの背後に隠れ（[vcs.go:14-137](../../../internal/vcs/vcs.go#L14-L137)）、メモリ上の状態は `Session` が持つ（[session.go:416-431](../../../internal/session/session.go#L416-L431)）。サーバーはその状態をレビュー UI 向けの API として公開する（[server.go:127-228](../../../internal/server/server.go#L127-L228)）。 <!-- b_g9874mdv -->

## 構成 <!-- b_2pgbpd4n -->

- VCS 抽象化と focus 解決（`internal/vcs`、`internal/focus`）: git・sl・jj の差異を吸収し、`Focus` を解決する（[vcs.go:14-137](../../../internal/vcs/vcs.go#L14-L137)）。
- レビューセッション管理（`internal/session`）: コメント・差分・ラウンドを保持し review.json に永続化する（[session.go:416-431](../../../internal/session/session.go#L416-L431)）。
- デーモンとプラン CLI（`internal/daemon`）: デーモンのセッション管理と plan・status・stop などの CLI を担う（[daemon.go:246-252](../../../internal/daemon/daemon.go#L246-L252)）。
- ローカル HTTP サーバー（`internal/server`）: API と埋め込みアセットを配信する（[server.go:127-228](../../../internal/server/server.go#L127-L228)）。
- 設定・共有・live（`internal/config`、`internal/share`）: 設定のマージ、共有 CLI、live プロキシ（[config.go:462-528](../../../internal/config/config.go#L462-L528)）。
- forge 同期（`internal/forge`、`internal/github`、`internal/gitlab`）: PR・MR のコメント同期（[forge.go:126-136](../../../internal/forge/forge.go#L126-L136)）。
- コメント操作とレビュー解決（`internal/comment`、`internal/review`）: コメント CLI とレビューファイルのパス解決（[review\_file.go:37-39](../../../internal/review/review_file.go#L37-L39)）。 <!-- b_h8fjsywk -->

## 相互作用 <!-- b_qp748mbf -->

- セッション管理は VCS 抽象化を呼び出して変更ファイルと差分を得る。
- サーバー、設定・共有、forge 同期、コメント操作はいずれもセッションの型と操作に依存する。
- コメント操作とデーモン側 CLI は、レビューファイルのパスやセッションキーのやり取りで互いを参照する。
- forge 同期は `forge.Provider` を介して GitHub と GitLab を差し替える。 <!-- b_xy6pqpsh -->

## 公開インターフェース <!-- b_nxyz44bg -->

- `DetectVCS` と `VCS` は使う VCS 実装を選び、共通操作を提供する。
- `NewServer` はルートを登録した `Server` を返す。
- `LoadConfig` は global と project の設定を統合する。
- `RunComment` と `RunComments` は CLI のコメント操作の入口である。 <!-- b_8gy50z1v -->

> [!TIP]
> **まとめ**
> internal は VCS とセッションを土台に、サーバー、CLI、forge 同期を重ねた構成である。 <!-- b_r6n9vtpe -->
