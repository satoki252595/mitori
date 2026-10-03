# 12. 用語集 <!-- b_dcy3250q -->

| 用語 | よみ | 英語 | 説明 |
|---|---|---|---|
| critWaitTimeout | くりっとうぇいとたいむあうと | — | opencode 連携で crit wait の短いタイムアウトを延長する関数。 |
| CritJSON | くりっとじぇいそん | CritJSON | レビュー状態をディスクに保存する JSON 構造。コメントやラウンドの情報を持つ。 |
| 再アンカー | さいあんかー | re-anchor | ずれたピンを別の要素に付け直す操作。 |
| Sapling | さぷりんぐ | — | `sl` コマンドで操作するバージョン管理システム。VCS の実装の一つ。 |
| Server | さーばー | — | HTTP ルーティングとセッション状態を束ねる中心の型。 |
| share target | しぇあたーげっと | — | 共有先サーバーの URL と認証情報を持つ設定項目。 |
| SessionEntry | せっしょんえんとりー | — | デーモンの PID・ポート・cwd・ブランチ等を記録する構造体。 |
| DiffScope | でぃふすこーぷ | — | 差分の範囲を表す型。layer と full_stack の二つがある。 |
| 統合 | とうごう | integration | 各エージェント向けに配置するファイル群。`crit install` で入れる。 |
| Pierre | ぴえーる | — | app.js 内の差分表示ビュー。`ensurePierreView` などで管理される。 |
| ピン | ぴん | pin | ページ上の要素に付けるコメントの目印。 |
| pin モード | ぴんもーど | — | `reduceToggle` が扱う二つのモードの一方。もう一方は navigate。 |
| フォーカス | ふぉーかす | Focus | レビュー対象が作業ツリーか範囲かを表す型。`Focus` 構造体で保持する。 |
| forge | ふぉーじ | — | GitHub や GitLab など、変更要求を扱うホスティング基盤の総称。 |
| フック | ふっく | hook | レビュー終了時などに実行されるシェルコマンド。`on_finish_unresolved` などの名前で指定する。 |
| VCS | ぶいしーえす | version control system | git・Sapling・jj を共通の操作で扱うインターフェース。 |
| push buckets | ぷっしゅばけっつ | — | push するコメントを投稿可否で分類した 4 つの集合。 |
| ラウンド | らうんど | round | レビューの往復回数。エージェントの修正ごとに次のラウンドへ進む。 |
<!-- b_aab4ykwx -->
