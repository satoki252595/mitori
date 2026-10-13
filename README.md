# mitori

> 見取り図 — リポジトリ全体を「見て取れる」設計書に変換し、人間と AI が同じ設計書の上でレビュー・修正指示・議論を行うためのツール。

**pre-alpha / 2026-10-12更新。** cloneして手元のリポジトリを開くローカルアプリです。ブラウザで使います。通常利用に**Nix・Docker・Cloudflare・データベースサーバーは不要**です。

## まず使う

手元の**Bun 1.4.2以上とGit**を使います。LLM・対象言語のテストやlintも、普段使っているツールをPATHから利用します。

```sh
git clone https://github.com/satoki252595/mitori.git
cd mitori
bun --version # 1.4.2未満でも、他に新しいBunが入っていれば自動で切り替える
bun run start -- /absolute/path/to/your/repository
```

初回と`git pull`で依存が変わった後は、`bun run start`が新しいBunで依存も自動で入れます。初回とソース更新後だけ画面を自動ビルドし、ローカルURLを表示してブラウザを開きます。以降はビルド結果を再利用します。ブラウザを開かない場合は`--no-open`を付けます。起動を止めるには別のターミナルで`bun run start -- stop`を実行します。

リポジトリは公開しており、誰でもcloneできます（ライセンスはMIT）。`bun run start`はmitoriのフォルダで実行してください。配布用バイナリは直接実行でき、Bunも不要です（[対応環境](#対応環境と確認状況)）。

**Nixを普段使っている場合**は、同じclone後に次を使います。direnvの許可は不要です。以下のLLM設定・停止コマンドも`bun`の前に`scripts/nd`を付けます。

```sh
scripts/nd bun --version
scripts/nd bun run start -- /absolute/path/to/your/repository
```

<details>
<summary>起動できない場合：direnv blocked・古いBun・Unknown lockfile version・bun upgradeのEACCES</summary>

`direnv: … .envrc is blocked`は自動環境読み込みの許可待ちです。上の`scripts/nd`なら許可せず起動できます。direnvを使いたい場合だけ、`cat .envrc`で内容（`use flake`）を確認してから`direnv allow`を実行してください。

Bunが古くても`bun run start`は新しいBun（`$BUN_INSTALL`・`~/.bun`・PATH上の他のBun・プロジェクトのNixの順）を探し、同じ引数で起動し直します。切り替えた旨を1行で知らせます。実機のBun 1.3.13で`bun run start -- --version`の成功を確認済みです。

`error: Unknown lockfile version`（`warn: Ignoring lockfile`を伴う）は、`bun install`を古いBun（1.4.2未満）で直接実行したときの表示で、ファイルは変わりません。`bun run start`を使うか、下のように新しいBunを絶対パスで指定します。

自動切替できない場合だけ、手動で新しいBunを明示します。lockfileを削除しません。例えば既存の`~/.bun/bin/bun`が1.4.2以上なら：

```sh
~/.bun/bin/bun --version
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run start -- /absolute/path/to/your/repository
```

設定・停止にも同じBunを使ってください。起動内部と画面の接続コマンドは選択した実行ファイルを引き継ぎます。`/nix/store/…/bun`に対する`bun upgrade`のEACCESは、Nix管理ファイルを書き換えようとしたためです。プロジェクトNixを使い、store内のBunを直接更新しません。

</details>

## 普段のLLMを使う

1. ブラウザの**設定 → エンジン → 使うAI**で普段のツールを選びます（Muse・Codexは「思考の強さ」も選べます）。
2. 未ログインなら**公式○○にログイン**を押し、公式のブラウザ認証を完了します。ログイン済みなら省略できます。
3. **接続コマンドを作る**を押し、表示されたコマンドを端末で実行して設定を保存します。
4. **設定を再読み込み**を押します。設定画面の一覧で、使用中のエンジンに「使用中」と表示されます。

**APIキーは必須ではありません。** Claude Code・Codex・Muse・Cursor・Grok Build・Antigravityは本人の公式ツールのログインを使います。mitori独自のOAuthや認証情報の入力はなく、ログイン情報は公式ツールの保管先に保存されます。課金先・契約の利用枠は公式ツールで確認してください。

契約には利用上限があります。**枠内だけで使う場合は、提供元の超過課金・自動補充を無効にし、枠を使い切ったらリセットを待ってください。** mitoriは追加購入やAPI課金への自動切り替えを行いません。Codexが利用上限に達した場合は、提供元のメッセージ（例:「usage limit … try again at …」）を表示して生成を止めます。

ターミナルから直接設定する場合は次のコマンドを使います。設定コマンドはインストール・モデルのダウンロード・推論要求を行いません。

| 普段使っているもの | 設定コマンド（mitoriフォルダで実行） | 使い方 |
| --- | --- | --- |
| Claude Code | `bun run start -- setup claude` | 画面から生成・説明・修正提案 |
| Muse | `bun run start -- setup muse --effort high` | 画面から生成・説明・修正提案。`--effort`省略時は`max` |
| Codex | `bun run start -- setup codex --native --max-estimated-usd 1` | 画面から生成・説明・修正提案 |
| Ollama | `bun run start -- setup ollama --model MODEL_ID` | 起動済みのOllamaとローカルモデル |
| LM Studio | `bun run start -- setup lmstudio --model MODEL_ID` | 起動済みのローカルサーバー |
| Cursor | `bun run start -- setup cursor --repo /absolute/path/to/your/repository` | 普段のCursorのセッションで生成（MCP・準備/取り込み） |
| Antigravity | `bun run start -- setup antigravity --repo /absolute/path/to/your/repository` | 普段のAntigravityのセッションで生成 |
| Grok Build | `bun run start -- setup grok --repo /absolute/path/to/your/repository` | 普段のGrok Buildのセッションで生成 |

**Claude Code・Museの自動更新にはmitoriが自動で追従します。** 各社のツールが新しい版に入れ替わると、mitoriは同じ場所（`setup`で登録した場所）から新しい版を見つけ、実行ファイルの置き場所・持ち主・版・安全設定を確かめ直してから切り替え、画面に「新しい版に自動で切り替えました（旧版 → 新版）」と表示します。モデルや思考の強さなどの設定はそのまま残ります。確かめられなかったときは自動では切り替えず、地図のエンジンカードと設定画面に理由とコピーできるコマンド（`bun run start -- setup …`、前の設定を引き継ぎ）を示し、生成の失敗時と`bun run start -- doctor`にも同じ1行を出します。表示されたコマンドを端末で実行すると直ります。Codexはmitoriで確認済みの版（`0.160.0`）だけを使うため、別の版に更新された場合は自動では切り替えません。setupのやり直しでは直らないので、mitoriを更新（`git pull`）してください。

**普段のAIのセッションで生成する場合**（Cursor・Antigravity・Muse・Grok Build・Codexなど）は、画面の**生成手順をコピー**を押し、そのAIに貼り付けます。AIが準備パケットを読み、生成した文書をmitoriへ取り込みます。対象のソースやGitは変更しません。生成後のレビュー対応は、AIに次のように依頼できます。

> mitoriのレビューを取得し、変更案はmitori_submit_patchで提出してください。対象ソースを直接変更せず、人の確認を待ってください。

<details>
<summary>Codex・Ollama・LM Studio・外部セッションの補足</summary>

**Codex（画面から直接）**: 既定は`gpt-6.1-sol` / `high`です。検証済みCLIは`0.160.0`で、別版は安全設定の確認が済むまで拒否します。`--max-estimated-usd 1`は1ターンのAPI換算推計への同意額で、実行はサブスク認証と契約の利用枠に従います。購入済みの追加クレジットがある場合、その消費をmitori側では禁止できません（[公式の利用枠・クレジット説明](https://learn.chatgpt.com/docs/pricing)）。普段のCodexセッションからMCPで使う場合は`setup codex --repo …`を使います。

**Ollama / LM Studio**: `MODEL_ID`は置き換える値です。Ollamaは`ollama list`で取得済みモデル名を、LM Studioはアプリでモデルを読み込みDeveloper画面でサーバーを開始して表示されたIDを指定します。ローカルモデルはログインもAPIキーも不要で、品質はモデルとメモリ容量に依存します。既定の接続先はOllama `http://localhost:11434/v1`、LM Studio `http://localhost:1234/v1`です。Ollamaクラウドを使う場合だけ`bun run start -- auth ollama`で公式サインインし、確認した単価を指定してください。

**外部セッションのMCP登録**: 設定コマンドが表示する手順を1回実行します。既存のMCP設定は残し、`mitori`の項目だけ追加してください。Grokは対象repoの`.grok/config.toml`、Cursorは`.cursor/mcp.json`、Codexは共通設定（対象repoだけなら`.codex/config.toml`）、Antigravityは**Manage MCP Servers / Open MCP Config**で開く`~/.gemini/config/mcp_config.json`に登録します。

</details>

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

## 生成にかかる時間と費用の目安

画面の見積りは生成前に表示されます。2026-10-12に実際に測った例です（Apple M5 Max、各3,000ファイル前後のOSS、標準の範囲＝§0〜§13と主要モジュール）。

| 例 | かかった時間 | API換算の推計 |
| --- | --- | --- |
| [rea](https://github.com/morluto/rea)（TypeScript、2,962ファイル）· Muse high | 約45分（並列2〜3） | 約$0.66 |
| [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)（JavaScript、1,803ファイル）· Muse high | 約44分 | 約$0.54 |
| [text-to-cad](https://github.com/earthtojake/text-to-cad)（Python、2,932ファイル）· Muse high | 約44分 | 約$0.64 |
| 小さなGoサービス（20ファイル）· 普段のCursor / Antigravity / Museのセッション | 約8〜19分 | 各ツールの契約枠 |

API換算はサブスク利用時の請求額ではなく、比較用の推計です。思考の強さを上げるほど時間がかかります。生成中もページは開いたまま読めます。

[検証状況の詳細](docs/progress/verification-status.md)・[トレンドOSSでの品質確認](docs/progress/trend-quality-20261012/README.md)

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

## 対応環境

| 環境 | 状況 |
| --- | --- |
| macOS Apple Silicon | 主な開発・検証環境。Chrome・Firefox・WebKitの自動テストと実Chromeで確認 |
| Linux x64 / arm64 | 配布バイナリとCI、Dockerでの起動を確認 |
| Windows x64 | 配布バイナリの自己診断と選択した操作をCIで確認（全操作・各LLMでの生成は未確認） |

バイナリは`bun run build:bin`で作れます（macOS `dist/mitori-darwin-arm64`、Linux `dist/mitori-linux-x64`）。ライセンスはMIT（[ライセンス](#ライセンス)）です。各環境・各LLMの確認の詳細は[検証状況](docs/progress/verification-status.md)にあります。

## ライセンス

MIT（[LICENSE](LICENSE)）です。配布バイナリと画面に同梱される依存とそのライセンスは[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)にあります。開発に参加する場合は[CONTRIBUTING.md](CONTRIBUTING.md)、脆弱性の報告は[SECURITY.md](SECURITY.md)を読んでください。

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

失敗したテストだけをLinuxで再確認する場合は、`--steps install,unit --unit-file scripts/start.int.test.ts`のようにファイルを指定できます。指定しない`unit`は全テストを実行します。

最新の引き継ぎと残課題は[HANDOFF](docs/HANDOFF.md)、作業規約は[AGENTS.md](AGENTS.md)と[CLAUDE.md](CLAUDE.md)を参照してください。
