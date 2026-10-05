# 公式ログインと契約枠を優先する接続

2026-10-06。[Issue #8](https://github.com/satoki252595/mitori/issues/8)。APIキー必須の初期導線を公式ツールの認証へ改めた。開発・検証は既存Nix、通常利用は手元のBun/Gitを維持。新規依存・契約・デプロイはない。

## 実装

- 設定のログインボタンで、本人の見える端末から`auth <provider>`を開始。ブラウザ専用APIは固定provider enumだけを受け付け、CLI/MCP/bearer、任意パス・引数を拒否する。
- TTYで実行ファイル・SHA・認証保管先を確認し、各実行直前に同一性を再検証する。出力は本人の端末へ直接渡し、neutral cwdは終了・失敗の両方で削除する。
- Museは保存APIキーの優先を避けるため、影響を表示して本人が確認した後、公式`logout`→`login`を行う。他のMuseセッションもログアウトする。失敗・差し替え時は後続を実行しない。
- Grokは公式Buildセッションが既定、APIは`--api`で明示。MCP登録手順も追加。Antigravityは認証専用コマンド未確認のため公式手順を開く。
- Ollamaローカルは認証不要。Cloud用`signin`は既定loopbackサーバーに固定し、remote host環境変数を継承しない。正常なキーなしローカル接続を「未ログイン」と表示しない。
- READMEに短い手順と契約上限・超過設定を記載。`opened`は端末へのdispatchで、認証成功・追加費用なしの保証ではない。

## 検証

| 検証 | 成功結果 |
| --- | --- |
| `scripts/nd bun run check` | 全7工程、3.45秒。型・Svelte・Biome・境界・台帳・予算・契約索引が緑 |
| setup・MCP案内・webのコマンド生成 | 13件、113 assertions |
| 認証CLI | 8件、106 assertions。固定argv、Muse解除と失敗停止、非TTY/agent拒否、差し替え、制御文字、認証保管先、Grokの標準名と旧名 |
| HTTP認証境界とOS起動計画 | 5件、65 assertions。偽装web/bearer、CLI/MCP、匿名、cross-site、追加引数拒否。二重quoteを無害なfixtureで検証 |
| native IOのneutral cwd/cleanup | 1件。実行プロセスはmock |
| ローカル認証表示 | 1件、4 assertions。CLI未ログイン・remote missing keyと区別 |
| CLI JA/EN help golden | 2件、84 assertions |
| Chromium認証ボタン・Grok session/API・再読み込み時の選択保持・Ollama・Antigravity | 1件。mock endpointのみ、実認証しない |

実ログイン・ログアウト、実LLM推論、プラン購入・課金設定変更は自動検証で実施していない。認証完了と利用可能なモデル・残枠は本人が公式ツールで確認する。以前のMuse実検証を更新版や他providerの証拠へ付け替えない。PRのCI結果と統合commitはIssueに追記する。

公式出典と確認範囲は[調査記録](../research/subscription-login-20261006.md)。
