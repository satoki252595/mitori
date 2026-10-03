# レビュー中核群 <!-- b_rba8bc6e -->

- ファイル 0 · 35700 行 · 重要度 1.00
- 子モジュール 9
<!-- b_q78jzrmw -->

> [!NOTE]
> **この章で分かること**
> - この群は crit のレビュー機能の中核で、CLI・セッション・HTTP・VCS を含む。
> - 中心となるデータは CritJSON として保存されるレビュー状態である。
> - 各子モジュールは役割ごとに分かれ、相互に import し合っている。 <!-- b_8mkn8ykv -->

## 責務 <!-- b_ztnk2pen -->

この群は、コードレビューの対象選択（Focus）、コメントやラウンドを持つ Session、その HTTP 公開、VCS 差異の吸収を担う（[session\_focus.go:45-68](../../../internal/session/session_focus.go#L45-L68)）。 crit コマンドの入口は cmd/crit にあり、処理は他の子モジュールへ委ねられる（[cli\_dispatch.go:11-23](../../../cmd/crit/cli_dispatch.go#L11-L23)）。 <!-- b_ze5s7skf -->

## 構成 <!-- b_h8p8xvbe -->

- VCS抽象化層（internal/vcs）: git・Sapling・jj を `VCS` インターフェースの背後に隠す（[vcs.go:14-137](../../../internal/vcs/vcs.go#L14-L137)）。
- レビュー状態管理（internal/session）: `Session` にファイル・コメント・ラウンドを集約する（[session.go:416-431](../../../internal/session/session.go#L416-L431)）。
- フォーカスとコメント: `Focus` と `internal/comment` の CLI を持つ（[session\_focus.go:45-68](../../../internal/session/session_focus.go#L45-L68)）。
- 設定・認証・起動引数: `LoadConfig` や `RunAuth` など。
- CLI 入口と統合導入（cmd/crit）: コマンドの振り分けを行う（[cli\_dispatch.go:11-23](../../../cmd/crit/cli_dispatch.go#L11-L23)）。
- 終了プロンプトとフック: プロンプト描画とフック実行、ストーリー取り込み。
- デーモン管理とセッションCLI: デーモンの起動・探索・停止。
- PR/MR 同期: GitHub と GitLab の `Provider` 実装。
- HTTP サーバー層: `Server` が `/api/` を公開する（[server.go:171-209](../../../internal/server/server.go#L171-L209)）。 <!-- b_2vrn5ymt -->

## 相互作用 <!-- b_p5k7be66 -->

- `session` は差分や履歴の取得を `vcs` に依存し、PR/MR 同期や focus とも相互に参照する。
- `server` は `session`・設定・focus を参照して API を提供する。
- `cmd/crit` は設定・デーモン・フォーカス・forge 同期を呼び出して配線する。
- 設定とデーモンは、起動引数の解決で相互に import する。 <!-- b_tp7za8na -->

## 公開インターフェース <!-- b_40ptx9wj -->

- `Focus` / `Session.SetFocus`: レビュー対象の切り替え（[session\_focus.go:45-68](../../../internal/session/session_focus.go#L45-L68)）。
- `NewServer`: HTTP 層の生成（[server.go:127](../../../internal/server/server.go#L127)）。
- `crit` の各サブコマンド: 外部からの入口（[cli\_dispatch.go:11-23](../../../cmd/crit/cli_dispatch.go#L11-L23)）。 <!-- b_7hyvyk2a -->

> [!TIP]
> **まとめ**
> VCS の差異を吸収し、`Session` が状態を持ち、`Server` と CLI がそれを公開する構成である。 <!-- b_fscnmaqx -->
