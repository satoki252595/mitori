# フォーカスとコメント <!-- b_5hzz0jr9 -->

- ファイル 28 · 3943 行 · 重要度 0.41
<!-- b_v1r6jwg8 -->

> [!NOTE]
> **この章で分かること**
> - レビューの「フォーカス」（作業ツリーか範囲か）が何を表すかを学ぶ。
> - コメントCLIがスコープをどう解決して書き込むかを学ぶ。
> - 型エイリアスで各パッケージがどう結びついているかを学ぶ。 <!-- b_wprjs4sw -->

## 責務 <!-- b_zsjfrnb0 -->

このモジュールは、レビュー対象を表す `Focus` と、そのスコープに沿ったファイル一覧・差分の構築を担う（[session\_focus.go:45-68](../../../internal/session/session_focus.go#L45-L68)、[session\_focus.go:510](../../../internal/session/session_focus.go#L510)）。あわせて `internal/comment` が CLI からのコメント追加・返信・一覧表示を受け持つ（[run.go:19](../../../internal/comment/run.go#L19)）。`Focus` 自体は読み取り専用判定で常に false を返し、書き込み制御は持たない（[session\_focus.go:74](../../../internal/session/session_focus.go#L74)）。 <!-- b_y7hxz28d -->

## 公開インターフェース <!-- b_mvm0z8se -->

- `Focus`: `FocusWorkingTree` か `FocusRange` の種別を持つ構造体（[session\_focus.go:17-23](../../../internal/session/session_focus.go#L17-L23)）。
- `Session.SetFocus`: フォーカスを切り替える（[session\_focus.go:226](../../../internal/session/session_focus.go#L226)）。
- `PRFocusKey` / `MRFocusKey`: PR・MR 用のキーを作る（[session\_focus.go:133-146](../../../internal/session/session_focus.go#L133-L146)）。
- `RunComment`: `crit comment` の入口（[run.go:19](../../../internal/comment/run.go#L19)）。
- `ResolveCommentScope`: 上書き指定からスコープを決める（[scope.go:79](../../../internal/comment/scope.go#L79)）。 <!-- b_r2cda7mj -->

## 依存関係 <!-- b_dkaczv94 -->

`internal/session` は `internal/vcs` の `VCS` と `internal/forge` の型をエイリアスで再公開する（[types.go:6-10](../../../internal/session/types.go#L6-L10)）。`internal/comment` と `internal/review` は `session.CritJSON` や `Focus` を別名で参照する（[types.go:6-19](../../../internal/comment/types.go#L6-L19)）。 <!-- b_2tthh0cr -->

## データ構造 <!-- b_j79mmqkc -->

- `Focus`: `BaseRef`、`HeadSHA`、`Forge`、`ChangeNumber`、`DiffScope` などを保持する（[session\_focus.go:45-68](../../../internal/session/session_focus.go#L45-L68)）。
- `DiffScope`: `layer` か `full_stack`（[session\_focus.go:33-39](../../../internal/session/session_focus.go#L33-L39)）。
- `InheritedScope`: コメントが引き継ぐ HeadSHA・BaseSHA・DiffScope（[types.go:18-23](../../../internal/session/types.go#L18-L23)）。
- `bytesLRU`: リモートファイル内容のキャッシュ（上限 256）（[lru\_bytes.go:13](../../../internal/session/lru_bytes.go#L13)、[lru\_bytes.go:21-25](../../../internal/session/lru_bytes.go#L21-L25)）。 <!-- b_7vescjcz -->

## テスト <!-- b_0zmddvbh -->

- `internal/comment/list_test.go:34` の `TestListCommentsFromCritJSON_OrderAndFilter` は一覧の順序と絞り込みを確認する（[list\_test.go:34](../../../internal/comment/list_test.go#L34)）。
- `internal/comment/comment_json_input_test.go:21` は JSON 入力ファイルの読み込みを確認する。
- `internal/comment/comment_scope_override_test.go:8` はスコープ上書きフラグの解釈を確認する。 <!-- b_sn7anx4p -->

## 性能 <!-- b_h91adf0t -->

利用可能スコープの一覧は `scopeCacheTTL` で 2 秒間キャッシュされる（[session\_focus.go:650](../../../internal/session/session_focus.go#L650)）。リモートファイルは `bytesLRU` に保持される（[lru\_bytes.go:13](../../../internal/session/lru_bytes.go#L13)、[lru\_bytes.go:21-25](../../../internal/session/lru_bytes.go#L21-L25)）。 <!-- b_dyszfpzn -->

> [!TIP]
> **まとめ**
> `Focus` がレビュー対象の範囲を決め、コメント CLI がそのスコープを引き継いで書き込む。 <!-- b_65mkagmf -->
