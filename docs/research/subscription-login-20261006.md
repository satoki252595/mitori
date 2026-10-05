# サブスクリプションの公式ログイン連携

確認日: 2026-10-06。公式文書と、既にインストールされている CLI の `--help` / `login --help` だけを確認した。認証の開始、資格情報の読み出し、インストール、更新、推論、課金は行っていない。

## 決定

利用者に API key を必須として要求せず、既存の公式 CLI / アプリのアカウントログインを第一候補にする。mitori は OAuth token やブラウザ cookie を抽出せず、認証は公式ソフトに任せる。ログイン操作と生成操作を分け、ログイン専用コマンドが確認できない場合は手順を表示する。

サブスク枠には利用上限があり、追加購入・従量課金・自動補充を有効にしているアカウントは超過料金が発生し得る。mitori はプランの購入や請求設定の変更をしない。「ログイン成功」を「追加料金なし」や「このモデルが利用可能」と同一視しない。

## 認証だけを行う入口

以下のコマンド名は説明用。実行側は確認した絶対パスと固定 argv を使い、利用者の確認後に公式 CLI へ制御を渡す。`agent` は複数製品で名前が重なるため、Cursor / Grok の判別に使わない。

| 製品 | ログインだけの入口 | ログアウト / 状態 | mitori の接続方法 |
| --- | --- | --- | --- |
| Codex | `codex login`。遠隔環境は `codex login --device-auth` | `codex logout` / `codex login status` | 公式 Codex セッションの MCP または Pull |
| Claude Code | `claude auth login`。サブスク用では `--console` を付けない | `claude auth logout` / `claude auth status` | 確認済み lean CLI、または公式セッションの MCP / Pull |
| Cursor | 確認済み Cursor CLI の `login`。この Mac では `cursor-agent login` | `logout` / `status` | 公式 Cursor セッションの MCP または Pull |
| Antigravity | 単独の認証専用コマンドは未確認。公式アプリのサインイン、または利用者が端末で `agy` を開いてログイン | TUI の `/logout` / `/usage`、アカウント表示 | 公式 Antigravity セッションの MCP または Pull。認証ヘルパーは裸の `agy` を自動起動しない |
| Muse Code | 確認済み native binary の `login`。auto-update wrapper は実行しない | `logout`。機械可読の認証状態コマンドは未確認 | 既存の lean native CLI。資格情報は Muse Code 専用として扱う |
| Grok Build | 確認済み Grok native binary の `login --oauth`。遠隔環境は `login --device-auth` | `logout`、TUI の `/usage`。機械可読の認証状態コマンドは未確認 | 公式 Grok Build セッションの MCP または Pull |
| Ollama | ローカルモデルは認証不要。Cloud は `ollama signin` | `ollama signout`。ローカル稼働 / モデル一覧と Cloud 認証は別の状態 | 稼働中のローカル HTTP サーバー。Cloud は明示して別扱い |

### Codex

公式 OpenAI documentation は `codex login` のブラウザ認証、`login status`、`logout`、device code を明記している。ChatGPT ログインと API key 認証を分け、API key 利用は含まれる ChatGPT 枠ではなく API 料金になる。今回は公式 Codex の既存ログインを使う。[Authentication](https://learn.chatgpt.com/docs/auth)

OSS アプリが自分のクライアントとして登録する直接の Sign in with ChatGPT も公式に提供されている。PKCE、OIDC 検証、利用権限、アカウントごとの保存と更新が必要な別実装であり、今回の CLI セッション連携で必須ではない。Codex の client ID や保存 token を流用する理由にはならない。[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

### Claude Code

認証専用コマンド、JSON の `authMethod`、終了コードは CLI reference に定義されている。`auth login --console` は API 課金用なので、サブスクの入口とは区別する。[CLI reference](https://code.claude.com/docs/en/cli-reference)

Pro / Max は Claude と Claude Code の利用枠を共有する。`ANTHROPIC_API_KEY` があればサブスクより API key が優先され、API 課金になる。枠だけで使う場合は API credit への切り替えを選ばずリセットを待つ。認証出力を UI へ転送するときは email やアカウント情報を丸ごと保存しない。[Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)

### Cursor

公式 CLI はブラウザログインを推奨し、`login`、`status`、`logout` を提供する。`NO_OPEN_BROWSER=1` はログイン URL を表示する。`status` はアカウント情報や endpoint も表示するため、サーバーやブラウザには必要な状態だけを返す。[Authentication](https://cursor.com/docs/cli/reference/authentication)

プランには月ごとの利用枠がある。個人の on-demand は明示的な有効化が必要だが、Teams では既定で有効。追加料金を避けたい利用者には公式 dashboard の on-demand 設定を案内する。mitori は変更しない。[Usage-based charges](https://cursor.com/help/account-and-billing/overages)、[Models & Pricing](https://cursor.com/docs/models-and-pricing)

この Mac の `~/.local/bin/cursor-agent` はバージョン別ディレクトリ内の shell launcher への symlink。隣接する `node` と `index.js` を実行し、引数を転送する。確認した launcher 自体にダウンロード処理はなかった。launcher の SHA だけで隣接ファイルまで検証したとは扱わない。

### Antigravity

`agy` は起動時に OS keyring の既存セッションを使い、未認証ならブラウザログインを開く。SSH は URL と承認コードを使う。`/logout` は保存されたアカウントセッションを解除する。独立した `login` / `auth status` は公式 reference とローカル help では確認できなかった。裸の `agy` は agent の本体なので、認証だけを保証するヘルパーから起動しない。[Installation and auth](https://antigravity.google/docs/cli/install/)

CLI は各プランの機能に含まれ、Google AI Pro / Ultra で利用枠が増える。購入済み AI credit による超過利用は `AI Credit Overages` の `Never` / `Always` で選ぶ。枠内だけなら `Never` を公式設定で選ぶ。Gemini API key mode は別の API 接続であり、同じ Google ログインとして扱わない。[Plans](https://antigravity.google/docs/plans)

### Muse Code

公式認証には初回のブラウザサインインと `/login` がある。既存 native CLI の `login --help` は Meta アカウントをブラウザで承認する認証専用コマンドと明記する。`META_API_KEY` が最優先で、保存 API key、保存ブラウザセッションの順になる。`logout` は保存された認証を消すが環境変数は消さない。[Authentication and billing](https://dev.meta.ai/docs/muse-code/auth)

サブスクは Muse Code CLI にサインインして使うもの。CLI onboarding が接続する資格情報は Muse Code 専用で、アカウントに追加作成した API key は従量課金。資格情報を汎用 HTTP adapter にコピーしない。地域や契約により提供内容が異なる。[Subscriptions](https://dev.meta.ai/docs/muse-code/subscriptions)

mitoriの`auth muse`は本人のTTYで認証解除の影響を表示して確認した後、公式の`logout`→`login`を実行する。保存APIキーの優先を避けるためで、途中失敗なら後続のログインを開始しない。認証用プロセスは`META_API_KEY`を継承せず、各ステップ前に確認済み実行ファイルの同一性を再確認する。既存の他のMuseセッションもログアウトされる。課金形態の機械可読確認は未対応のため、生成時のbillingは推測せずunknownを維持する。

今回確認した native は `~/.local/bin/muse-bin-1.4.3-R5018.1`。バージョン marker `~/.local/bin/.muse-version` から選ぶ既存方式を維持する。`~/.local/bin/muse` wrapper は確認作業で実行していない。

追加確認: 上記 native の `--help` / `exec --help` / `auth --help` と公式設定文書には、browser-only / subscription-only を強制する起動 flag または設定項目が見つからなかった。`--provider meta` は認証方式を選ばず、`--api-key-stdin` は API key の入口。保存認証をそのまま隔離環境へ渡す場合、認証方式と実請求は未確認として表示する。[Configuration and context](https://dev.meta.ai/docs/muse-code/configuration)

保存 API key を使っていた利用者が契約枠へ切り替える公式の手順は、本人が `muse logout` で保存認証を解除し、`muse login` でブラウザ再認証すること。環境の `META_API_KEY` も別に解除する。mitori はこの解除を自動では行わず、ログインだけで契約枠へ切り替わったと保証しない。今回、実際の認証ファイルは読んでいない。[Authentication and billing](https://dev.meta.ai/docs/muse-code/auth)

### Grok Build

公式 Grok Build はアカウントのブラウザ認証と API key を提供する。ローカル native `login --help` は `--oauth` と `--device-auth` を明記する。認証だけなら `login --oauth` を使い、裸の `grok` は使わない。[Getting Started](https://docs.x.ai/build/overview)、[CLI Reference](https://docs.x.ai/build/cli/reference)

2026-06 からの公式 FAQ は SuperGrok の週次共有枠に Build を含め、Usage の内訳に API / Build / Chat / Imagine / Voice を挙げている。古い「SuperGrok は API / Build に一切使えない」という断定はしない。一方、この説明だけで任意の Console API key が必ず共有枠へ請求されるとは確認できない。今回の既定は Grok Build のアカウントログインとし、HTTP API は明示した別経路とする。購入 credit と Auto Top Up は追加料金の入口。[Grok FAQ](https://docs.x.ai/grok/faq)

MCP は公式に stdio をサポートする。利用者が確認して登録する例は次の通り。下記は実行していない。[MCP Servers](https://docs.x.ai/build/features/mcp-servers)

```sh
grok mcp add mitori -- /absolute/path/to/mitori mcp --repo /absolute/path/to/repo
```

バイナリは確認済みの絶対パスを使う。source 実行なら command を絶対 Bun、先頭 args を絶対 CLI entry にする。登録先は `~/.grok/config.toml` の `[mcp_servers.mitori]`、project scope は `.grok/config.toml`。stdio の command / args をそのまま記載できる。

Grok は公式 ACP も提供するが、本体の hook / MCP / tool 継承を抑える lean 条件は未検証。ログインできることだけを根拠に mitori の直接実行 engine に追加しない。[Headless & Scripting](https://docs.x.ai/build/cli/headless-scripting)

### Ollama

Ollama は API 専用ではない。アプリと CLI によるローカルモデル実行があり、`ollama signin` / `signout` は Cloud の公式認証コマンド。ローカルの既存モデルと `localhost:11434` を使う通常の接続に API key やアカウントは不要。[Quickstart](https://docs.ollama.com/quickstart)、[CLI Reference](https://docs.ollama.com/cli)

Ollama Cloud はアプリ / CLI のアカウントログインを使える。直接 Cloud API に接続する場合の API key とは別の入口。ローカル URL でも Cloud モデルを指定すると遠隔推論になるため、「loopback なので無料 / offline」とは表示しない。[Cloud](https://docs.ollama.com/cloud)

## 実装に反映する条件

- ボタンは公式ログイン専用コマンド、または公式アプリの手順を示す。購入ページを自動で開いてプラン変更しない。
- 非 TTY のサーバーから対話認証を裏で実行せず、確認したコマンドを端末で実行できるようにする。
- 公式 CLI の絶対パスを解決して表示し、引数は固定する。shell command としてユーザー入力を連結しない。
- Cursor と Grok の共通名 `agent` を製品の証明にしない。Muse は native を選ぶ。
- API key の値、OAuth token、cookie、アカウント email を mitori のログや settings、Git に保存しない。
- 保存認証があること、指定モデルが使えること、利用枠が残ること、追加料金が発生しないことは別に扱う。

実際の認証および課金を伴う生成は、この資料の検証対象外。上記の入口と料金説明は 2026-10-06 時点の公式資料に基づく。
