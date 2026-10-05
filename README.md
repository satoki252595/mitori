# mitori

> 見取り図 — リポジトリ全体を「見て取れる」設計書に変換し、人間と AI が同じ設計書の上でレビュー・修正指示・議論を行うためのツール。

**pre-alpha / 2026-10-06更新。** cloneして手元のリポジトリを開くローカルアプリです。ブラウザで使います。通常利用に**Nix・Cloudflare・データベースサーバーは不要**です。

## まず使う

手元の**Bun 1.4.2以上とGit**を使います。LLM・対象言語のテストやlintも、普段使っているツールをPATHから利用します。

```sh
git clone https://github.com/satoki252595/mitori.git
cd mitori
bun install --frozen-lockfile
bun run start -- /absolute/path/to/your/repository
```

初回とソース更新後だけ画面を自動ビルドし、ローカルURLを表示してブラウザを開きます。以降はビルド結果を再利用します。ブラウザを開かない場合は`--no-open`を付けます。起動を止めるには別のターミナルで`bun run start -- stop`を実行します。

リポジトリは現在privateのため、cloneにはアクセス権が必要です。`bun run start`はmitoriのフォルダで実行してください。配布用バイナリは直接実行でき、Bunも不要です（[対応環境](#対応環境と確認状況)）。

## 普段のLLMを使う

1. ブラウザの**設定 → エンジン → 使うAI**で普段のツールを選びます。
2. 未ログインなら**公式○○にログイン**を押します。ターミナルで実行ファイルを確認し、公式のブラウザ認証を完了します。ログイン済みなら省略できます。
3. **接続コマンドを作る**を押し、表示されたコマンドを端末で実行して設定を保存します。
4. **設定を再読み込み**を押します。

**APIキーは必須ではありません。** Claude Code・Codex・Muse・Cursor・Grok Buildは本人の公式ツールへのログインを使い、対応する契約の利用枠で動かします。Antigravityは公式アプリまたは本人のCLIでサインインする手順を案内します。mitori独自のOAuthや認証情報の入力はありません。ログインボタンはmacOS/Linuxの手元のターミナルを開き、開けない環境ではコピーするコマンドを表示します。JSON編集は不要で、コマンドはターミナルの現在位置に依存しません。

契約には利用上限があります。**枠内だけで使う場合は、提供元の超過課金・自動補充を無効にして、枠を使い切ったらリセットを待ってください。** mitoriは追加購入やAPI課金への自動切り替えを行いません。Museのログイン操作は、端末での確認後、優先される保存APIキーを公式`logout`で解除してからブラウザで`login`します。他のMuseセッションもログアウトします。ログインを省略する場合も、公式ツールでアカウント認証を確認してください。ログイン開始を成功とは扱わず、ログイン情報は公式ツールの保管先へ保存します。ブラウザやmitoriの設定JSONへ渡しません。[提供元ごとの認証・利用枠の確認](docs/research/subscription-login-20261006.md)。

ターミナルから直接設定する場合も、次の短いコマンドを使えます。設定コマンドはインストール・モデルのダウンロード・LLMへの推論要求を行いません。

| 普段使っているもの | 設定コマンド（mitoriフォルダで実行） | 利用方法 |
| --- | --- | --- |
| Claude Code | `bun run start -- setup claude` | ログイン済みの`claude`を利用。画面から生成・説明・修正提案 |
| Muse | `bun run start -- setup muse` | 認証済みnative binaryを検出。既定は`muse-spark-1.3-contributor` / `max` |
| Grok Build | `bun run start -- setup grok --repo /absolute/path/to/your/repository` | 公式Buildにアカウントログイン。既存の利用枠でMCP・準備/取り込みを利用 |
| Ollama | `bun run start -- setup ollama --model qwen3:8b` | 起動済みのOllamaと取得済みローカルモデルを利用 |
| LM Studio | `bun run start -- setup lmstudio --model MODEL_ID` | 起動済みローカルサーバーを利用。画面のモデルIDを指定 |
| Codex | `bun run start -- setup codex --repo /absolute/path/to/your/repository` | 普段のCodexセッションからMCP・文書生成の準備/取り込みで利用 |
| Cursor | `bun run start -- setup cursor --repo /absolute/path/to/your/repository` | 普段のCursorからMCP・文書生成の準備/取り込みで利用 |
| Antigravity | `bun run start -- setup antigravity --repo /absolute/path/to/your/repository` | 普段のAntigravityからMCP・文書生成の準備/取り込みで利用 |

`qwen3:8b`は例です。`ollama list`などで手元のモデルを確認し、その名前を指定してください。**Ollamaはアプリ・CLIでも使え、ローカルモデルはログインもAPIキーも不要**です。mitoriは起動済みのローカルHTTPサーバーへ接続します。これは有料クラウドAPIの契約を必要とするものではありません。LM Studioの既定接続先は`http://localhost:1234/v1`、Ollamaは`http://localhost:11434/v1`です。

**Ollamaクラウドを使う場合だけ**は、画面の公式ログインボタン、または`bun run start -- auth ollama`で`ollama signin`へ進みます。ローカルサーバー経由で公式認証を使い、クラウドの契約枠・クレジットを消費します。cloudモデルはローカル無料扱いにせず、設定に確認した単価を指定してください。直接`ollama.com`へ接続するAPIキー方式とは別です。[Ollamaの公式認証](https://docs.ollama.com/api/authentication)。

**Codex・Cursor・Antigravity・Grok Buildを使う場合**は、設定コマンドが表示するMCP登録手順を1回実行します。既存のMCP設定は残してください。AIには次のように依頼できます。

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
| macOS Apple Silicon | バイナリ起動・実Muse修正/Undoを検証済み。Bun直接起動も確認 |
| Linux x64 | バイナリビルド・バージョン表示と既存CIを検証済み。今回のBun起動導線のLinux実行は未確認 |
| Windows x64 | クロスビルド済み。Windows上の実行確認は未完了。通常Bun起動は現時点で対象外 |

バイナリは`bun run build:bin`で実行環境向けに作ります。macOSは`dist/mitori-darwin-arm64`、Linuxは`dist/mitori-linux-x64`を直接実行できます。現在のコンパイル対象は上記3種類です。

今回の設定導線・APIは無課金のmock/loopbackと必要範囲の回帰で検証しました。[今回の検証記録](docs/progress/onboarding-20261006.md)。Grok・Ollama・LM Studio・各外部アプリでの実LLM推論は今回実施していません。Museの既存実検証はADR記載のnative版が対象で、更新版へ証跡を引き継ぎません。[LLM起動条件](docs/design/adr/0015-configurable-llm.md)。

既存の3 OSS（m3e-canvas、jev-ultrafast、Laya）では実Muse生成とソース照合を行いました。無効な引用先は1,421件中0件でしたが、説明の省略・曖昧さは残ります。[品質検証](docs/progress/oss-quality-2026-10-05/README.md)。Chromium・Firefox・WebKitは既存CIで検証済みですが、実Safari・日本語IMEは未確認です。一部の性能目標にも警告が残っています。

リポジトリはprivateで、ルートLICENSEは未設定です。一般公開・OSS配布の準備は別途必要です。

## 開発する場合

開発・検証の依存管理は引き続き`flake.nix` / `flake.lock`を使います。利用者の通常起動とは別の手順です。

```sh
scripts/nd bun install --frozen-lockfile
scripts/nd bun run check
scripts/nd bun test
```

最新の引き継ぎは[HANDOFFの冒頭 §★](docs/HANDOFF.md)、残課題は[タスク台帳](docs/progress/backlog-2026-10-05.md)、作業規約は[AGENTS.md](AGENTS.md)と[CLAUDE.md](CLAUDE.md)を参照してください。
