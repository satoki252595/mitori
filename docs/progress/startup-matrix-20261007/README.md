# 起動・LLM別の検証（2026-10-07 JST）

> 2026-10-07の履歴を保持しています。本人環境の最新接続結果は末尾の「本人の実設定での追加確認（2026-10-11）」、Codex / LM Studioの後続実生成と現在の残課題は[2026-10-11の一覧](../remaining-20261011/README.md)を参照してください。Claudeのログインは現在の続行条件ではありません。

作業: [Issue #11](https://github.com/satoki252595/mitori/issues/11)。利用者の貼付ログを再現し、Nix・既存Bun・既存DockerハーネスでREADMEの手順を確認した。利用者はDockerをLinux検証用とする方針を選択した。全LLMの実推論完了とは報告しない。

## 修正した原因

- `.envrc`は`use flake`。direnvの許可待ちでも`scripts/nd`は使える。利用者の許可設定は変更していない。
- PATHで選ばれるBunは旧Nix profileの1.3.13。プロジェクトNixと既存`~/.bun/bin/bun`は1.4.2。旧版はlockfileVersion 2を解析できず、Nix store内の`bun upgrade`はEACCESになった。lockfileは再生成していない。
- 新しいBunを絶対パスで呼んでも、旧`start`の`bun scripts/start.ts`がPATH上の古いBunを再選択した。package scriptを`"$npm_execpath" scripts/start.ts`へ変更し、選択したBunを起動・子プロセス・MCP登録手順まで維持する。最低版の確認と、依存不足時の同じBunを使う案内も追加した。

実装修正は`fb2c63702ba157c063ddd2000b40e18016673a9c`。グローバルのBun/PATH、ユーザーの認証・MCP設定を変更せず、新しい依存を追加せず、モデルを取得していない。

## 起動確認

macOS arm64、128GiB RAM。Nixはflake.lock固定のBun 1.4.2、通常起動は既存のBun 1.4.2。旧Bunを先頭に置いたPATHのまま、新Bunの絶対パス起動を確認した。

`fb2c637`を一時フォルダへ`git clone --no-hardlinks`で2回cloneした。`node_modules`と`dist`はコピーせず、プロジェクト内へfrozen installした。Bunの取得済みダウンロードキャッシュは再利用しており、ネットワークキャッシュもない新規Macへの導入確認ではない。

| 確認 | Nix | 通常ローカル |
| --- | --- | --- |
| frozen install | exit 0 / 1,376ms | exit 0 / 1,018ms |
| 初回UIビルド・repo scan | 成功 / ready | 成功 / ready |
| health / UI / JS | すべてHTTP 200 | すべてHTTP 200 |
| launcherのBun | プロジェクトNix 1.4.2 | 指定した既存Bun 1.4.2 |
| 停止 | HTTP 200 / exit 0 | HTTP 200 / exit 0 |
| lockfile / checkout | 不変 / clean | 不変 / clean |
| LLM要求 | 0 | 0 |

一時HOME、mitoriデータ、対象fixture、cloneを削除した。[測定JSON](fresh-clone.json)。READMEのNix・ローカルコマンドで同じ導線を利用できる。Bunの再選択には、PATH上の偽Bunを実際に先頭へ置く回帰テストを残した。

## LLM別の確認範囲

Nix・通常ローカルで8種類の`setup … --print`がexit 0。設定保存・認証操作・推論要求は発生していない。MCP共通プロトコルの`initialize`と`tools/list`は8ツールを返した。[設定結果](setup-matrix.json)。これは各公式アプリでのMCP接続・実生成の証明ではない。

| LLM / 既存ツール | 確認した状態 | 実回答・残る操作 |
| --- | --- | --- |
| Muse native 1.4.3 | 既存認証で起動成功 | Nix・ローカルでExplain成功。課金先・サブスク枠は未確認 |
| Ollama 0.35.0 | localhost:11434稼働、取得済みモデル | 下記モデル別結果。モデル取得・クラウド要求なし |
| Claude Code 2.1.290 | CLIあり、ログアウト中 | 利用者の公式ログイン後に実回答を確認する |
| LM Studio | アプリあり、localhost:1234未起動 | 利用者がモデル読み込み・サーバー開始、モデルIDを指定する |
| Codex 0.160.0 | ChatGPT認証済み、隔離設定でMCP実接続成功 | Nix/通常の両方で8ツール取得。実セッションの文書生成は未確認 |
| Cursor 2026.10.01-e373342 | 公式認証済み、隔離設定でMCP実接続成功 | Nix/通常の両方で8ツール取得。実セッションの文書生成は未確認 |
| Antigravity 1.3.0 | 隔離設定の一覧読込成功、認証状態未確認 | アプリでMCP再読込・ツール表示を確認する。実生成も未確認 |
| Grok Build 1.0.46 | 隔離設定でMCP実接続成功、認証状態未確認 | Nix/通常の両方で8ツール取得。公式ログイン・実生成は未確認 |

ログイン画面を開いたことは認証成功と扱わない。本人のアカウント、キー、課金情報をGitへ保存しない。外部セッションのモデルはそのツール側で選び、prep/ingestとMCPを利用する。mitori内部から直接呼ぶCLI/HTTPの検証とは経路が異なる。

追加のnative確認は、公式CLIを一時HOME/設定で起動し、mitoriプロセスとの本物の`initialize` / `tools/list`を記録した。Codexは`app-server --stdio`の`mcpServerStatus/list`（thread/turnなし）、Cursorは`mcp list-tools mitori`、Grokは`mcp doctor mitori --json`。Nix Bun・通常Bunの両方で各8ツール、exit 0。本人の認証を使わず、モデル要求・ツール実行も0。Codexのresource一覧要求には未対応のmethod-not-foundを返したが、tool inventoryはtoolsErrorなしで取得できた。[native測定・再現設定](native-mcp.json)。

Antigravityの`mcp list`は設定を読めたが、mitoriを起動せずhandshakeも観測しなかった。公式アプリのManage MCP Servers、またはCLIの`/mcp`で再読み込みし、ツールを確認する必要がある。一時設定とworkspaceは削除し、MCP子プロセスの残存0を確認した。

さらにnative `agy mcp add mitori -- …`→`agy mcp list`を一時設定・空白入りrepo pathで確認し、両コマンドexit 0だった。設定一覧の確認に留まり、接続とは扱わない。生成するAntigravityの手順にも公式1コマンド登録を追加した。CLIがない場合のアプリ用JSON例は維持する。Cursorの現行`mcp --help`にはadd/add-jsonがないためJSON追加が必要であり、READMEの「JSON編集不要」はmitoriのLLM設定に限定した。

## 実Explainの品質・費用

production daemonと本物のproviderを使い、一時`go-small`の`internal/meta/fetch.go:40-42`、`NormalizeISBN`の短い日本語説明を要求した。アンカー付きthread → 見積もり → 確認済みjob → 回答/引用の確認を通した。修復0回、並列1、出力上限600token。全文の設計書生成やFix/Undoの再試験ではない。

Museは各1回のExplain要求、Contributor / max / toolsなし、120秒上限。実行前にAPI相当$0.001〜0.01/件・合計推計cap $0.10を案内し、各job cap $0.05、見積もり$0.000223で開始した。記録されたusageは本文からの推計で、hidden reasoningと実請求の保証ではない。正規化されたstart eventは0件だったため、これをnative起動回数やLLM要求0の根拠にはしない。

| provider / モデル | Nix | 通常ローカル | 回答・品質 |
| --- | --- | --- | --- |
| Muse Contributor / max | 8.879秒 / 推計$0.000279 | 5.300秒 / 推計$0.000275 | 70文字 / 53文字。各引用1件有効、不正0件。意味をソースと照合し一致 |
| Ollama `qwen3-coder-next:latest` | 13.049秒 / $0 | 0.932秒 / $0 | 95文字・50出力token / 82文字・40token。各引用1件有効、不正0件。意味をソースと照合し一致 |
| Ollama `qwen3:4b` | 9.653秒 / 失敗 | 4.499秒 / 失敗 | thinkingに600tokenを消費し本文0文字、finish_reason=length、E_BUDGET_EXCEEDED |
| 同 `/no_think`追加 | 4.592秒 / 失敗 | 4.586秒 / 失敗 | 同じ結果。回避策として採用しない |

Ollamaは各試行1回のHTTP推論要求、90秒上限、ローカルのみ。失敗4件と成功2件を保持した。成功モデルは既に取得済み約51.7GBの非thinkingモデルで、この128GiBホストの結果である。小型マシン向けの万能推奨ではない。Nixと通常の時間差にはモデル読み込み・キャッシュ状態が含まれ、runtimeの速度比較には使わない。

成功した回答は「ハイフンと空白を除去し、大文字に変換する」でコードと一致。各実行でfixtureのソースbytesは不変、daemon停止・fixture/一時mitori HOME削除を確認した。raw回答・private provider記録・認証先は保存せず、[安全な測定JSON](live-explain.json)を残した。API相当推計はMuse合計$0.000554、Ollama合計$0。

## Dockerは検証用

既存OrbStackのLinux arm64 image（Ubuntu 24.04.5 / Bun 1.4.2 / Node 22.23.3）を利用。既存apt/直接取得ハーネスは今回の利用者許可の例外。新しい実利用Docker環境は作らない。

```sh
scripts/nd bash scripts/linux-ci.sh --arch arm64 \
  --steps install,onboarding --seccomp default --out /tmp/mitori-linux-onboarding
```

frozen installとonboardingは成功。Claude/Muse CLIは未導入をexit 2で示す。他8経路（外部4、Grok API、Ollama、LM Studio、OpenAI）の設定プレビューは成功。4つのclientInfo名で行ったMCP確認は合成クライアントによる共通通信試験で、公式アプリの接続ではない。コンテナ内部loopbackのhealth/UI・SIGTERM終了は成功。認証情報をmountせず、LLM要求0。[Docker結果](docker.json)。

別の`sandbox`単位は既存`--seccomp unconfined`で10/10成功。自分のloopback接続と対象tree/TMPDIRへの書き込みを確認し、外向き通信・HOME/.gitへの書き込み・秘密ファイルの読み込みを拒否した。mitori所有のビルドキャッシュ等の許可条件はADR-0013に従う。このbwrap確認用条件を通常Docker起動の要件にしない。

mitori daemonは127.0.0.1へbindしHostも検証するため、`docker -p`だけのホストブラウザ利用は案内しない。HTTP providerの非TLS接続先もliteral loopback限定で、`host.docker.internal`を通す設定へ緩めない。MacのCLI/authをLinuxへコピーしない。

## 回帰と確認の経過

- `scripts/nd bun test scripts/start.test.ts scripts/start.int.test.ts`: 4成功 / 21 assertions。
- `scripts/nd bun run check`: tsc / svelte-check / biome / boundaries / cr-ledger / budgets / contract-indexが成功、3.59秒。
- scoped scripts型検査、Biome、shell構文、`git diff --check`が成功。
- Antigravityの登録案内追加後、`scripts/nd bun test apps/cli/src/commands/setup-integrations.test.ts apps/cli/src/commands/setup.test.ts`: 7成功 / 70 assertions。空白・引用符・shell構文を含むpathを実shellでargvへ戻し、追加コマンドのquoteと`--`を確認。該当2ファイルBiomeとCLI型検査も成功。
- 初回の設定検証用helperがGrokのPOSIX quoteをJSON quoteとして比較して失敗した。製品の出力は正しく、helperのassertだけを直して該当matrixを再実行した。
- Docker helperの初回は同期spawnに非対応の`detached`指定が型検査で失敗した。非同期spawnとprocess group cleanupへ直し、失敗した型検査とDocker onboardingだけを再実行した。

[PR #12](https://github.com/satoki252595/mitori/pull/12)の[初回CI](https://github.com/satoki252595/mitori/actions/runs/37490234719)（head `a0a98d6`）はLinux unit 2,991成功 / 134skip / 4todo / 1失敗。追加したstartup intがcold UI build中にBun testの既定5秒で停止され、exitCode nullとなった。別Bun選択のassertは通っているが、この初回を起動成功とは扱わない。fixtures/golden/size/Linux binaryは未実行。ブラウザ側は350成功 / 14skip、共有2成功、a11y8成功。

startup intに初回buildを含む60秒の明示上限を付けた。Macでは失敗した1fileのみ再実行し1成功 / 5 assertions（2.31秒）。Bunの選択やMCP出力のassertは維持する。既存Dockerハーネスへ`--unit-file`を追加し、指定時はexport内の実ファイルだけを実行する（未指定は従来の全unit）。

```sh
scripts/nd bash scripts/linux-ci.sh --arch arm64 --steps install,unit \
  --unit-file scripts/start.int.test.ts --seccomp default \
  --out /tmp/mitori-linux-startup
```

このLinux再検証はfresh export→frozen install→cold UI buildで1file / 1test / 5 assertions成功、2.758秒、LLM0、認証mountなし。[結果](linux-startup-retest.json)。OrbStackの18CPUは元Ubuntu CIと負荷条件が異なり、5秒超えを同条件再現したとは報告しない。最終CIの結果はPRとIssue #11に記録する。

## 利用者の協力が必要な確認

1. Claude Codeの公式ログイン（`claude auth login`または画面の公式ログインボタン）。認証完了だけを知らせてもらい、キー等は受け取らない。
2. LM Studioでモデル読み込み・Developerのサーバー開始。モデルIDを知らせてもらう。
3. 外部4ツールはREADMEの`setup … --repo …`が表示するMCP登録手順を本人の設定へ追加し、接続とprep/ingestの短い生成を確認する。既存設定を自動上書きしない。Antigravity/Grokは公式ログイン状態も確認する。

認証後の追加実推論は、そのproviderの見積もり・上限を付けて実施する。未実施部分を「残なし」「全サブスク実利用確認済み」としない。

## 公式仕様の確認（2026-10-07）

- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility): OpenAI互換はsubset。reasoning設定にもモデルごとの制約があり、mitoriのHTTP経路は現在専用thinking値を送らない。
- [Ollama thinking](https://docs.ollama.com/capabilities/thinking): `/api/show`のthinking.values/defaultと回答・reasoningの区別を確認。手元の`qwen3:4b`はvalues=[true]、coder-nextは[false]。小型モデルの能力を別モデルへ一般化しない。
- [Qwen3公式説明](https://qwenlm.github.io/blog/qwen3/): `/no_think`はpromptのsoft switchとして説明される。本環境では実際の回避に成功しなかったため、READMEに成功例として採用しない。

提供元の認証手順とサブスク条件は[前回の公式調査](../../research/subscription-login-20261006.md)を参照する。Windows native、実Safari/IME、一般公開/ライセンス、既存性能課題はこの起動確認の対象外。

## 本人の実設定での追加確認（2026-10-11）

上記は2026-10-07の隔離設定による記録。今回、このプロジェクトだけに4クライアントのMCP設定を作成し、本人の通常HOMEと実フォルダで接続確認を試みた。その後の共通設定の追加を含め、現在はCursor・Grok・Antigravity本体で各8ツールを確認済み。Codexは登録が有効だが接続は未確認。4経路とも外部セッションからの生成は今回実施していない。共通起動は既存の`<repo>/scripts/nd bun <repo>/scripts/start.ts mcp --repo <repo>`。初回資源の準備とソース更新後のキャッシュ更新を通し、最終的に`assetsReady=true`を確認した。ソフトの導入、認証操作、LLM要求、MCPツール実行は0、追加LLM費用は$0。

`.codex/config.toml`、`.cursor/mcp.json`、`.grok/config.toml`、`.agents/mcp_config.json`は元々存在せず、0600で作成した。初回のproject登録では既存の共通MCP設定を変えず、ローカルのGit除外へ4ファイルを追加した。元の除外内容を保持し、Undo用の私有バックアップを作成。個人パス、raw設定、認証情報はこの記録へ保存しない。

まずproject設定だけを追加した時点の結果は以下の通り。Antigravityの後続確認は表の後に別記する。

| クライアント | 実設定での結果 | 残る確認 |
| --- | --- | --- |
| Codex 0.160.0 | プロジェクトの既存trustを保ち、`mcp list --json`でmitori有効を確認 | 他の7連携を子プロセスだけで無効化する検証用overrideが`invalid transport`で拒否。全table overrideも8連携へmergeされたため起動せず、実設定のtool inventoryは未確認 |
| Cursor 2026.10.01-e373342 | 公式`mcp enable mitori`後、実`list-tools`で8ツール、exit 0 | この外部セッションからの生成は今回実施していない |
| Grok 1.0.50 | 公式project登録・対象フォルダのtrust後、実`doctor`で8ツール、4/4 checks成功、exit 0 | この外部セッションからの生成は今回実施していない |
| Antigravity CLI 1.3.3 | project JSON作成後も通常cwdと公式UIで作成したproject ID指定の両一覧が「設定サーバーなし」、exit 0 | 実クライアントがproject設定を読む経路とツール表示 |
| Antigravity IDE 2.5.5 | 実フォルダを開き、Manage MCP ServersのRefresh完了後も`No MCP servers installed` | project設定の読み込み経路を確認する |
| Antigravity 2.12.2 | 実フォルダに結び付くprojectを選択し、Settings → Customizations → Installed MCP Serversで公式Refreshを1回実施しても`No MCP servers installed` | 別アプリのIDE 2.5.5と区別し、project設定の読み込み経路を確認する |

Cursorの承認はプロジェクトのパスと完全なサーバー設定のhashに結び付き、名前だけの共通承認ではない。既存承認を全て残して1件だけ追加し、disabled設定は不変。Grokは`--trust --cwd <repo> mcp doctor mitori --json`で対象フォルダだけをtrustし、他フォルダの判断は保持した。repo内のhook/pluginは存在せず、doctorによる接続確認だけを実施した。いずれも認証ファイルは変更していない。

Antigravityはproject JSONが読み込まれない実測を踏まえ、利用者の通常設定の包括承認内で、公式共通設定`~/.gemini/config/mcp_config.json`へmitoriの1件だけを追加した。元は0 bytes、mode 0644。正確な元bytesを私有バックアップへ保存し、既存設定の意味とmodeを保つatomic mergeを実施した。登録先をhelpで確定できない`agy mcp add`は使わず、公式に記載されたファイルだけを変更した。他の既知のCodex・Cursor・Grok設定とGrok trustのhashは不変で、認証・trustも変更していない。

追加後の通常`agy mcp list`はexit 0でmitoriを表示した。続けてAntigravity本体2.12.2の公式UIでRefreshを1回実施し、完了後にmitori表示、toggle有効、`8 tools enabled`をrootが確認した。これを本体の接続成功として記録する。一覧だけから接続成功とは判断していない。IDE 2.5.5は共通設定の追加後に再確認しておらず、初回の表示なしという記録を保持する。初期失敗と共通設定後の成功は[追加証跡](native-mcp.json)の別項目に保存した。

Codexの失敗は検証用の一時overrideの検証エラーであり、通常の本人設定が壊れているとは判断しない。Antigravityも、設定が見えないことをログイン不足と推定しない。今回の登録作業を本人しか行えない残作業とは扱わず、実際に確認できた範囲を[追加証跡](native-mcp.json)へ分けて保存した。

最終の案内修正後もsetup対象2ファイルが8成功 / 85 assertions、7つの`check`が全て成功（5.04秒）。この追加確認のために全テストやCIは再実行していない。公式のproject設定仕様は[Codex](https://learn.chatgpt.com/docs/extend/mcp#connect-codex-to-an-mcp-server)、[Cursor](https://cursor.com/docs/mcp#configuration-locations)、[Antigravity](https://antigravity.google/docs/mcp#global-and-workspace-server-configs)を2026-10-11に確認した。提供元の仕様とインストール済みアプリの実際の読み込み結果は区別する。
