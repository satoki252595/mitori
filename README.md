# mitori

> 見取り図 — リポジトリ全体を「見て取れる」設計書に変換し、人間と AI が同じ設計書の上でレビュー・修正指示・議論を行うためのツール。

**pre-alpha / 2026-10-07更新。** cloneして手元のリポジトリを開くローカルアプリです。ブラウザで使います。通常利用に**Nix・Docker・Cloudflare・データベースサーバーは不要**です。

## まず使う

手元の**Bun 1.4.2以上とGit**を使います。LLM・対象言語のテストやlintも、普段使っているツールをPATHから利用します。

```sh
git clone https://github.com/satoki252595/mitori.git
cd mitori
bun --version # 1.4.2以上を確認
bun install --frozen-lockfile
bun run start -- /absolute/path/to/your/repository
```

初回とソース更新後だけ画面を自動ビルドし、ローカルURLを表示してブラウザを開きます。以降はビルド結果を再利用します。ブラウザを開かない場合は`--no-open`を付けます。起動を止めるには別のターミナルで`bun run start -- stop`を実行します。

リポジトリは現在privateのため、cloneにはアクセス権が必要です。`bun run start`はmitoriのフォルダで実行してください。配布用バイナリは直接実行でき、Bunも不要です（[対応環境](#対応環境と確認状況)）。

**Nixを普段使っている場合**は、同じclone後に次を使います。direnvの許可は不要です。以下のLLM設定・停止コマンドも`bun`の前に`scripts/nd`を付けます。

```sh
scripts/nd bun --version
scripts/nd bun install --frozen-lockfile
scripts/nd bun run start -- /absolute/path/to/your/repository
```

<details>
<summary>起動できない場合：direnv blocked・古いBun・bun upgradeのEACCES</summary>

`direnv: … .envrc is blocked`は自動環境読み込みの許可待ちです。上の`scripts/nd`なら許可せず起動できます。direnvを使いたい場合だけ、`cat .envrc`で内容（`use flake`）を確認してから`direnv allow`を実行してください。

`Unknown lockfile version`が出た場合は`bun --version`と`command -v bun`を確認します。このlockfileにはBun 1.4.2以上が必要です。古いNix profileのBun 1.3.13がPATHで優先されていた実例があります。lockfileを削除せず、上のプロジェクトNixか、手元にある新しいBunを明示します。例えば既存の`~/.bun/bin/bun`が1.4.2以上なら：

```sh
~/.bun/bin/bun --version
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run start -- /absolute/path/to/your/repository
```

設定・停止にも同じBunを使ってください。起動内部と画面の接続コマンドは選択した実行ファイルを引き継ぎます。`/nix/store/…/bun`に対する`bun upgrade`のEACCESは、Nix管理ファイルを書き換えようとしたためです。プロジェクトNixを使い、store内のBunを直接更新しません。

</details>

## 普段のLLMを使う

1. ブラウザの**設定 → エンジン → 使うAI**で普段のツールを選びます。
2. 未ログインなら**公式○○にログイン**を押します。ターミナルで実行ファイルを確認し、公式のブラウザ認証を完了します。ログイン済みなら省略できます。
3. **接続コマンドを作る**を押し、表示されたコマンドを端末で実行して設定を保存します。
4. **設定を再読み込み**を押します。

**APIキーは必須ではありません。** Claude Code・Codex・Muse・Cursor・Grok Buildは本人の公式ツールへのログイン経路を利用できます。課金先・契約の利用枠は公式ツールで確認してください。今回のMuse実回答試験では課金先・サブスク枠までは確認していません。Antigravityは公式アプリまたは本人のCLIでサインインする手順を案内します。mitori独自のOAuthや認証情報の入力はありません。ログインボタンはmacOS/Linuxの手元のターミナルを開き、開けない環境ではコピーするコマンドを表示します。mitoriのLLM設定はJSON編集不要で、接続コマンドはターミナルの現在位置に依存しません。

契約には利用上限があります。**枠内だけで使う場合は、提供元の超過課金・自動補充を無効にして、枠を使い切ったらリセットを待ってください。** mitoriは追加購入やAPI課金への自動切り替えを行いません。Museのログイン操作は、端末での確認後、優先される保存APIキーを公式`logout`で解除してからブラウザで`login`します。ログインを省略する場合も、公式ツールでアカウント認証を確認してください。ログイン開始を成功とは扱わず、ログイン情報は公式ツールの保管先へ保存します。ブラウザやmitoriの設定JSONへ渡しません。[提供元ごとの認証・利用枠の確認](docs/research/subscription-login-20261006.md)。

ターミナルから直接設定する場合も、次の短いコマンドを使えます。設定コマンドはインストール・モデルのダウンロード・LLMへの推論要求を行いません。

| 普段使っているもの | 設定コマンド（mitoriフォルダで実行） | 利用方法 |
| --- | --- | --- |
| Claude Code | `bun run start -- setup claude` | ログイン済みの`claude`を利用。画面から生成・説明・修正提案 |
| Muse | `bun run start -- setup muse` | 認証済みnative binaryを検出。既定は`muse-spark-1.3-contributor` / `max` |
| Grok Build | `bun run start -- setup grok --repo /absolute/path/to/your/repository` | 公式Buildにアカウントログイン。既存の利用枠でMCP・準備/取り込みを利用 |
| Ollama | `bun run start -- setup ollama --model MODEL_ID` | 起動済みのOllamaと取得済みローカルモデルを利用 |
| LM Studio | `bun run start -- setup lmstudio --model MODEL_ID` | 起動済みローカルサーバーを利用。画面のモデルIDを指定 |
| Codex | `bun run start -- setup codex --repo /absolute/path/to/your/repository` | 普段のCodexセッションからMCP・文書生成の準備/取り込みで利用 |
| Cursor | `bun run start -- setup cursor --repo /absolute/path/to/your/repository` | 普段のCursorからMCP・文書生成の準備/取り込みで利用 |
| Antigravity | `bun run start -- setup antigravity --repo /absolute/path/to/your/repository` | 普段のAntigravityからMCP・文書生成の準備/取り込みで利用 |

`MODEL_ID`は置き換える値です。**Ollama**はアプリを起動（または既存CLIで`ollama serve`）し、`ollama list`で取得済みモデル名を確認して指定します。ローカルモデルはログインもAPIキーも不要です。**LM Studio**はアプリでモデルを読み込み、Developer画面でローカルサーバーを開始し、表示されたモデルIDを指定します。`lms` CLIは必須ではありません。設定コマンドはサーバーの起動やモデルの取得を代行しません。mitoriは起動済みのローカルHTTPサーバーへ接続します。これは有料クラウドAPIの契約を必要とするものではありません。LM Studioの既定接続先は`http://localhost:1234/v1`、Ollamaは`http://localhost:11434/v1`です。

Ollamaの動作・回答品質はモデルとメモリ容量に依存します。今回の128GiB Macでは、取得済み`qwen3-coder-next:latest`（約51.7GB）で短い説明と出典を確認しました。小型の`qwen3:4b`は出力600token上限をthinkingに使い切り、本文が空になりました。`/no_think`を加えても同じ結果でした。設定が保存できたことと、実回答が成功したことを区別してください。[モデルごとの結果](docs/progress/startup-matrix-20261007/README.md)。

**Ollamaクラウドを使う場合だけ**は、画面の公式ログインボタン、または`bun run start -- auth ollama`で`ollama signin`へ進みます。ローカルサーバー経由で公式認証を使い、クラウドの契約枠・クレジットを消費します。cloudモデルはローカル無料扱いにせず、設定に確認した単価を指定してください。直接`ollama.com`へ接続するAPIキー方式とは別です。[Ollamaの公式認証](https://docs.ollama.com/api/authentication)。

**Codex・Cursor・Antigravity・Grok Buildを使う場合**は、設定コマンドが表示するMCP登録手順を1回実行します。既存のMCP設定は残してください。AIには次のように依頼できます。

Codex・Grok・Antigravityの公式CLIがある場合は、表示された`mcp add mitori -- …`の1コマンドで登録できます。Cursorの現行CLIは追加コマンドがないため、表示された設定を`.cursor/mcp.json`または`~/.cursor/mcp.json`の`mcpServers`へ追加します。既存ファイル全体を置き換えず、`mitori`の項目を追加してください。

> mitoriのレビューを取得し、変更案はmitori_submit_patchで提出してください。対象ソースを直接変更せず、人の確認を待ってください。

初回の文書生成は、画面の**生成手順をコピー**で表示する手順を、そのAIへ渡します。mitoriが作る準備パケットのREADMEに従って文書を生成・取り込みます。モデルは普段のツール側で選びます。外部セッションのツール・hookはそのツールの設定に従うため、mitoriの自動LLM起動とは区別しています。

<details>
<summary>別モデル・独自API・細かな設定</summary>

Museのモデルを指定する例:

```sh
bun run start -- setup muse --model muse-spark-1.3-contributor --effort max
```

PATHで見つからないCLIは`--binary /absolute/path/to/binary`を指定します。Museは自動更新ランチャーではなくnative binaryを使います。

公式ログインだけを端末から行う場合は`bun run start -- auth claude`などを使います（`muse`・`codex`・`cursor`・`grok`・`ollama`も選べます）。実行ファイルのパスとSHAを確認してから公式ツールへ渡し、モデルは呼び出しません。Antigravityは認証専用コマンドが未確認のため、公式アプリの手順を表示します。

GrokをAPIで使いたい場合だけ、画面で**APIキーで接続する**を選ぶか、`bun run start -- setup grok --api`を実行します。起動前に`XAI_API_KEY`を環境変数へ設定してください。キーを後から設定した場合はdaemonを停止し、その端末から再起動します。キー自体を設定画面・設定JSON・Gitへ保存しません。APIキーの請求先と枠は公式設定で確認してください。

OpenAI互換APIも追加SDKなしで利用できます。`MODEL_ID`、URL、キーの環境変数名、確認した単価（USD/百万token）を指定してください。

```sh
bun run start -- setup openai --model MODEL_ID \
  --base-url https://your-provider.example/v1 --key-env YOUR_API_KEY \
  --in-price 2 --out-price 6
```

別のGrok APIモデルは`setup grok --api --model …`と`--in-price` / `--out-price`を指定します。API経路の既定`grok-4.7`は2026-10-06の公式価格を確認した設定値（input $2 / output $6）です。実請求額の保証ではありません。[モデル・価格の確認記録](docs/research/llm-onboarding-20261006.md)。

HTTP連携は無ツールのChat Completionsを使用します。`--effort`はHTTPへ送信せず、Museなど対応CLIで使います。任意CLIのJSON argv・単価・タイムアウトは画面の「詳細設定（独自CLI・API）」にあります。保存前の確認だけなら`setup … --print`、選択肢は`bun run start -- setup --help`で確認できます。

</details>

## できることと変更の扱い

- リポジトリを解析し、見取り図と出典付きの設計文書を生成・閲覧する。
- 文書やコードの箇所にコメントし、説明・修正提案を受け取る。
- 文書の翻訳・やさしい説明・修正を確認して適用し、Undoする。
- 文書をHTMLとして書き出す。暗号化URL共有は任意のCloudflare機能で、現在は未デプロイ。

mitori内のAI変更はアンカーと対象範囲を確認し、side repoでテスト・lint・型検査を行います。人が採用して初めて未コミットの変更を適用し、Undoできます。対象リポジトリのGit refs/objectsへは書きません。[side repoの設計](docs/design/adr/0012-git-side-repo.md)。

自動起動するLLMはlean環境を使い、対象リポジトリの設定・hook・ツールを継承しません。生成前には送信内容・費用見積りを確認します。ローカルLLMの品質や構造化応答の能力はモデルごとに異なり、変更は同じ検証と人の確認を通ります。

## 利用技術

| 用途 | 技術 |
| --- | --- |
| 本体・ローカルHTTP/SSEサーバー | TypeScript、Bun |
| ブラウザ画面 | Svelte 5、Vite 8、CodeMirror 6 |
| データ保存 | SQLite（Bun内蔵。別サーバー不要） |
| コード解析 | Tree-sitter / WebAssembly |
| 見取り図 | SVG、ELKレイアウト |
| リポジトリ・変更検証 | 手元のGit、対象言語のテスト・lint・型検査ツール |
| LLM | 既存CLI、OpenAI互換HTTP API、外部セッションのMCP/Pull |
| 開発環境・回帰検証 | Nix、Biome、TypeScript、Bun test、Playwright |

## 対応環境と確認状況

| 環境 | 状況 |
| --- | --- |
| macOS Apple Silicon | Nix・通常Bun 1.4.2の起動、実Muse/Ollamaの短いExplainを確認。既存版の実Muse修正/Undoは別記録 |
| Linux arm64 / Docker | frozen install、コンテナ内部の画面・設定プレビュー・MCP共通通信を確認。実LLM・ホストブラウザ接続は対象外 |
| Linux x64 | バイナリビルド・バージョン表示と既存CIを検証済み。今回のDocker起動確認はarm64 |
| Windows x64 | クロスビルド済み。Windows上の実行確認は未完了。通常Bun起動は現時点で対象外 |

バイナリは`bun run build:bin`で実行環境向けに作ります。macOSは`dist/mitori-darwin-arm64`、Linuxは`dist/mitori-linux-x64`を直接実行できます。現在のコンパイル対象は上記3種類です。

2026-10-07の確認状況です。**設定プレビュー**は設定を書かない`setup … --print`、**実回答**はmitoriの実Explain APIで本文と引用先を確認した結果です。

| LLM | Nix / 通常ローカル | 実利用の確認状況 |
| --- | --- | --- |
| Muse | 両方の設定プレビュー・実回答成功 | native 1.4.3、Contributor / max。現在の認証の課金先・サブスク枠は未確認 |
| Ollama | 両方の設定プレビュー・実回答成功 | `qwen3-coder-next:latest`の短いExplainのみ。`qwen3:4b`は上記の失敗あり |
| Claude Code | 両方の設定プレビュー成功 | CLIあり・ログアウト中。公式ログイン後の実回答は未確認 |
| LM Studio | 両方の設定プレビュー成功 | アプリあり・ローカルサーバー未起動。モデル読み込みと開始後の実回答は未確認 |
| Codex / Cursor | 両方の設定プレビュー・公式CLIのMCP接続成功 | 公式ログイン済み。隔離した設定で8ツールを取得。実セッションの文書生成は未確認 |
| Grok Build | 両方の設定プレビュー・公式CLIのMCP接続成功 | 隔離した設定で8ツールを取得。公式ログイン状態・実生成は未確認 |
| Antigravity | 両方の設定プレビュー・公式CLIの設定読込成功 | 公式ログイン状態・アプリでのMCP接続・実生成は未確認 |

Codex・Cursor・Grokは本物のCLIで初期化と8ツールの取得を確認しました。本人の設定・認証は変更せず、LLM要求は送っていません。AntigravityのCLI設定一覧は接続確認にならないため、公式アプリの**Manage MCP Servers**でmitoriを再読み込みし、ツール表示を確認してください。DockerではClaude/Muse CLI未導入を正しく表示し、他の設定プレビューとMCP共通通信を確認しました。DockerでLLM認証・推論は行いません。[起動・LLM別の検証記録](docs/progress/startup-matrix-20261007/README.md)、[前回のmock・UI回帰](docs/progress/onboarding-20261006.md)、[LLM起動条件](docs/design/adr/0015-configurable-llm.md)。

既存の3 OSS（m3e-canvas、jev-ultrafast、Laya）では実Muse生成とソース照合を行いました。無効な引用先は1,421件中0件でしたが、説明の省略・曖昧さは残ります。[品質検証](docs/progress/oss-quality-2026-10-05/README.md)。Chromium・Firefox・WebKitは既存CIで検証済みですが、実Safari・日本語IMEは未確認です。一部の性能目標にも警告が残っています。

リポジトリはprivateで、ルートLICENSEは未設定です。一般公開・OSS配布の準備は別途必要です。

## 開発する場合

開発・検証の依存管理は引き続き`flake.nix` / `flake.lock`を使います。利用者の通常起動とは別の手順です。

```sh
scripts/nd bun install --frozen-lockfile
scripts/nd bun run check
scripts/nd bun test
```

**DockerはLinuxでの検証用です。** 普段の利用はNixまたは上のローカル手順を使います。既存の検証イメージはLLMの公式CLI・認証情報を含まず、ブラウザ向けのポート公開も行いません。Dockerだけで各サブスクLLMが使える手順としては案内しません。

既存ハーネスでLinux arm64の導線を再確認する場合：

```sh
scripts/nd bash scripts/linux-ci.sh --arch arm64 \
  --steps install,onboarding --seccomp default --out /tmp/mitori-linux-onboarding
```

`onboarding`は設定プレビュー、MCP共通通信、コンテナ内部のHTTP画面と停止を確認し、推論要求は送りません。Docker/OrbStackが起動済みである必要があります。イメージの依存構築は既存のapt・直接取得を含み、今回の検証に限って許可された例外です。開発の依存管理はNixを維持します。

最新の引き継ぎは[HANDOFFの冒頭 §★](docs/HANDOFF.md)、残課題は[タスク台帳](docs/progress/backlog-2026-10-05.md)、作業規約は[AGENTS.md](AGENTS.md)と[CLAUDE.md](CLAUDE.md)を参照してください。
