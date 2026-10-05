# ローカル起動と主要LLMの簡単設定（2026-10-06）

作業: [Issue #6](https://github.com/satoki252595/mitori/issues/6)。利用者の指示は、既存の実行環境・LLMを少ない操作で利用し、実際の手順をREADMEへ残すこと。

## 起動と設定

通常利用は既存のBun 1.4.2以上とGitを使う。`bun install --frozen-lockfile`後、`bun run start -- /absolute/path/to/repository`でproduction UIを用意して起動する。source・runtime・出力の状態でビルド結果を再利用し、更新・削除・欠落があれば作り直す。開発・検証は従来のNixを維持した。新しい依存・SDK・グローバルコマンド登録は加えていない。

画面の「設定 → エンジン → 使うAI」で接続コマンドを作り、利用者が端末で内容を確認して保存する。CLIの`setup`も同じ設定経路を使う。既存のログイン・モデル・APIサーバーを利用し、セットアップはインストール・モデルの取得・推論を行わない。Claudeは`--version`だけを上限付きで確認し、実行前後のSHAと版を人が確認するpinへ保存する。設定画面にはキー本体を入力しない。

| 接続先 | 採用した経路 |
| --- | --- |
| Claude Code | 既存のlean adapter。明示binaryとpinの不一致は起動前に拒否し、pin変更時は検出cacheを更新 |
| Muse | markerからnative binaryを検出。既存`muse-jsonl` profile、Contributor / maxが既定 |
| Grok | 既存genericへOpenAI互換HTTPを追加。`XAI_API_KEY`、既定モデルと確認済み単価 |
| Ollama / LM Studio | 起動済みloopback APIと取得済みモデル。実ローカルは明示ゼロ単価、既知cloud名はゼロ単価を拒否 |
| Codex / Cursor / Antigravity | MCP登録手順とprep/ingestを使う外部セッション。各アプリの設定ファイルは自動編集しない |
| 独自API / CLI | 折りたたんだ詳細設定と`setup openai`。独自モデルは単価も指定 |

コピーするコマンドには実daemonの起動パスと`--repo`を使い、端末のcwd・global `mitori`コマンドを前提にしない。source起動はBunと`scripts/start.ts`、compiled起動はbinaryを渡す。Claude専用slash commandを外部セッションの汎用生成手順に使わない。

## 安全・料金・生成元

HTTPは無ツール・statelessのChat Completions。遠隔HTTPS、literal loopback HTTP、環境変数のキー参照、redirect拒否、1MiB応答上限、timeout/cancel、正確な承認output capを実装した。エラー本文・キー・transport exceptionは出力しない。tool callとgeneric agentは拒否する。HTTP固有のreasoning設定は送らない。

provider切替ではendpointとkeyEnvを一つの接続として置換し、Grokのキー参照をローカル設定へ残さない。価格不明の生成は開始せず、失敗したHTTPも承認capをusageへ予約する。これは実請求・hidden token・provider側USD hard capの保証ではない。名前から分からないローカルproxyの課金は設定者による確認が必要。

外部セッションのモデルはそのツール側で選ぶ。指定なしの取り込みでは`generic:session`と記録し、以前のproviderのモデル名を引き継がない。明示した有効モデルと保存済みcacheの生成元は保持する。外部アプリのhook・ツールをmitoriが無効にしたとは扱わず、変更は`mitori_submit_patch`へ提出して人の確認を待つよう案内する。

## 検証

実LLMへの新しい有料要求、モデルダウンロード、Cloudflareデプロイは行っていない。

| 対象 | 実施内容・結果 |
| --- | --- |
| dev gate | `scripts/nd bun run check`: tsc / svelte-check / cr-ledger / budgets / contract-index成功。新pin helperの境界・formatを修正し、biome / boundariesの2単位だけ再実行して成功 |
| startup | `scripts/nd bun test scripts/start.test.ts`: 2成功。source変更・削除・runtime変更・出力欠落と`--version`を確認 |
| 起動smoke | 子プロセスPATHを既存Bunへのsymlinkと`/usr/bin:/bin`だけに限定。Nixコマンドなしでproduction UI HTTP 200、設定viewの実起動元、SIGTERM終了を確認。Bun自体はこの機械の既存runtimeで、別の未導入マシンのインストール検証ではない |
| 設定・HTTP料金 | `scripts/nd bun test apps/cli/src/commands/setup.test.ts packages/agent/src/adapters/generic-http.test.ts`: 13成功 / 132 assertions。確認前書込なし、Claude pin、budget、cloudゼロ単価拒否、tool拒否、応答・cancel上限、費用とキーの扱い |
| Claude検出 | pin / TOFU / warm poolの対象40成功。新pinへの検出切替、確認中の設定変更とbinary差し替えも個別再実行して成功。実Claude認証・推論は実施せず |
| 設定server | `scripts/nd bun test packages/server/src/settings/settings.test.ts`: 19成功。接続切替とrollback、起動元が保存されないことを確認 |
| CLI回帰 | `scripts/nd bun test apps/cli/src/commands/commands.test.ts apps/cli/src/main.test.ts`: 24成功 / 114 assertions |
| MCP | 対象12成功、登録手順2成功 / 12 assertions。別cwd、空白・引用符を含むrepo、無効path、cold initializeを確認 |
| UI単位 | provider / genの対象26成功。各プリセット、quote、外部生成手順を確認。cloud価格検証を追加しprovider単位だけ再実行して6成功 / 41 assertions |
| Chromium設定画面 | `scripts/nd bunx playwright test -c e2e/web/playwright.config.ts e2e/web/settings.pw.ts --project chromium`: 最初2成功 / 1失敗。完全一致label locatorをaccessible comboboxへ修正し、`--grep 'guided setup'`だけ再実行1成功（2.9秒）。Muse詳細、OllamaとCursorのコピー、browserからexec設定を書かないこと、一般設定を確認 |
| セッション生成元 | session / store / executeの対象19成功、強化したsession単位は15成功。新規・Grok切替後の未指定、明示Codex / generic、旧不明cache、session出力をpush経路が再利用する場合の実ApplySink入力を検査し、model呼び出し0で確認 |
| 最終gate | `scripts/nd bun scripts/check.ts biome boundaries cr-ledger contract-index`: 4単位成功（0.94秒）。`scripts/nd bunx tsc -b apps/cli apps/web e2e --pretty false`: 成功。agent / gen / coreの変更もproject referencesと対象型検査で確認 |
| 最終Mac binary | `scripts/nd bun run build:bin`: 成功。`--version` / `setup grok --print`は成功。`_selftest --json`: integrity / web / parse / ELK / Shiki / SQLiteすべて成功、embedded / standalone。sourceとcompiledの双方で実起動元とproduction UI HTTP 200、終了を再確認 |

CLI / agent / server / web / e2eの対象型検査と、Svelte check（0 errors / 0 warnings）、変更ファイルのBiome・whitespaceも成功した。sessionの新テストで`scope`の型注釈が不足した点も修正し、失敗した型検査単位は再実行して成功した。

最終Mac binaryのSHA-256は`cc9d5027c4f86740cac5dc0efe128954ec0f1f34313f6f9e935e2bc57aa1883f`。base `59ba629`に英語helpの`--repo`説明1行を加えた作業ツリーから再ビルドし、自己検査とcompiledのHTTP / 起動元 / 終了を再確認した。実測値は[自己検査JSON](onboarding-binary-20261006.json)へ保存した。今回のhost binaryを、前回のall-target測定や性能値へ付け替えない。

## PR CIの経過

[PR #7](https://github.com/satoki252595/mitori/pull/7)の[初回CI](https://github.com/satoki252595/mitori/actions/runs/37383098685)（head `59ba629`）ではMacのChromium / Firefox / WebKit **347成功 / 14skip**、共有 **2成功**、a11y **8成功**。Linuxの7checkと20projectすべてのsemantic型検査は成功し、unitは **2,973成功 / 134skip / 4todo / 2失敗**だった。失敗は追加したCLIヘルプに対する日英2つのgolden未更新だけで、後続のfixtures / golden / size / Linux binaryはまだ実行されていない。この初回runを全体successとは扱わない。

英語genの`--repo`説明も日本語と揃え、`scripts/nd env MITORI_UPDATE_GOLDEN=1 bun test apps/cli/src/commands/cli.int.test.ts --test-name-pattern 'CLI-G-001'`で2期待ファイルだけを更新した。差分を確認後、更新envなしで同じ単位を再実行し、**2成功 / 80 assertions**。ソース・検証記録とgoldenは専用commitへ分ける。push後の既存CIは自動実行され、最終結果はPRとIssueへリンクして保存する。

## 確認範囲

Grok・実Ollama・実LM Studio・各外部アプリでの実推論は今回実施していない。Muse markerは更新版`1.4.3-R5018.1`で、既存実生成の検証対象`1.4.2-R4684.1`へ遡って証跡を付け替えない。Linuxの今回のBun通常起動、Windows native、実Safari/IMEは未確認。一般公開範囲とLICENSEも未決定。

公式仕様・価格・パスの出典は[調査記録](../research/llm-onboarding-20261006.md)、HTTPの制約は[ADR-0015](../design/adr/0015-configurable-llm.md)。最新利用手順は[README](../../README.md)。
