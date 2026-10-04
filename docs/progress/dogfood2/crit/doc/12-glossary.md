# 12. 用語集 <!-- b_w2wcwrvf -->

| 用語 | よみ | 英語 | 説明 |
|---|---|---|---|
| withReady | うぃずれでぃ | withReady | セッション準備前の要求を拒否するサーバのミドルウェア。 |
| ConfigPresence | こんふぃぐぷれぜんす | config presence | 設定 JSON にキーが明示されたかを記録する構造体。 |
| ShareTarget | しぇあたーげっと | share target | 共有先サービスの URL と認証情報などをまとめた設定。 |
| スコープ | すこーぷ | scope | コメントが属する差分範囲。layer / full-stack / working-tree を指定できる。 |
| story | すとーりー | story mode | 差分ハンクを章に並べた説明。取り込み時にカバレッジを検証する。 |
| セッション | せっしょん | session | 1 回のレビューの状態をまとめた単位。コメントやファイル情報を保持する。 |
| セッションキー | せっしょんきー | session key | cwd・ブランチ・引数の SHA-256 から作る 12 桁の 16 進識別子。 |
| ChangeID | ちぇんじあいでぃー | change identifier | PR や MR を指す番号、プロジェクト、ホストの組。 |
| DiffHunk | でぃふはんく | diff hunk | unified diff の一塊の変更箇所とその行の列。 |
| デーモン | でーもん | daemon | レビュー用 HTTP サーバをバックグラウンドで動かすプロセス。 |
| Pierre | ぴえーる | Pierre | 差分表示に使うライブラリ。アダプタとビューで包んで使う。 |
| ピン | ぴん | pin | ページ上の要素に固定するコメントの目印。live モードで iframe 内の要素に付く。 |
| Focus | ふぉーかす | focus | レビュー対象を表す値。作業ツリーや範囲指定などの種別を持つ。 |
| forge | ふぉーじ | forge | GitHub や GitLab のようなコードホスティング基盤。`forge.Kind` で区別する。 |
| VCS | ぶいしーえす | version control system | Git・Sapling・jj を共通に扱うインターフェース。 |
| vendored アセット | べんだーどあせっと | vendored asset | リポジトリに取り込んだ外部成果物。ハッシュで検証する。 |
| benchstat | べんちすたっと | benchstat | Go のベンチ結果を比較するツール。bench-compare.py がその出力行を解析する。 |
| live モード | らいぶもーど | live mode | 既存の Web サイトをプロキシ越しにレビューする機能。 |
| ラウンド | らうんど | round | レビューの周回。完了ごとにコメントを新しい内容へ引き継ぐ。 |
| 連携 | れんけい | integration | 各エージェント向けに配布するファイル群。内容ハッシュで古さを判定する。 |
<!-- b_v0fwa4ab -->
