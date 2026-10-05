# mitori

> 見取り図 — リポジトリ全体を「見て取れる」設計書に変換し、人間と AI エージェントが同じ設計書の上でレビュー・修正指示・議論を行うためのツール。

**pre-alpha — 2026-10-06更新。** リポジトリ解析、文書生成、レビュー、修正提案とUndoを実装・検証しています。未確認の環境と品質上の限界は下記に記載しています。

本体はcloneしてローカルで起動するツールです。ブラウザからローカルのリポジトリを扱います。**Cloudflareへのデプロイは不要です。** AI生成には設定したLLMを使用するため、通信・認証・利用料金はそのプロバイダーに依存します。

## できること

- リポジトリを解析し、見取り図と出典付きの設計文書を生成・閲覧する。
- 文書やコードの箇所にコメントし、説明・修正提案を受け取る。
- 範囲を限定したコード変更をテスト・lint・型検査で確認し、人が採用する。適用は未コミットで、Undoできる。
- 文書の翻訳・やさしい説明・修正提案を確認して適用し、元に戻す。
- 文書をHTMLとして書き出す。暗号化したURL共有は任意のCloudflare機能で、現在は未デプロイ。

AIのコード変更はアンカーと対象範囲を確認し、side repoで検証します。対象リポジトリのGit refs/objectsには書き込みません。詳細は[side repoの設計](docs/design/adr/0012-git-side-repo.md)を参照してください。

## ローカルで起動する

必要な環境はGit、Nix（`nix-command` / `flakes`有効）、Bash 4以上です。Bunや解析・検証用のツールチェーンは、プロジェクトの`flake.nix` / `flake.lock`で管理します。

```sh
git clone https://github.com/satoki252595/mitori.git
cd mitori
```

現在のGitHubリポジトリはprivateのため、cloneにはアクセス権が必要です。macOS標準のBash 3.2しかない場合は、プロジェクトが固定したNix入力からBashを起動してから続けてください。

```sh
nix shell --inputs-from . nixpkgs#bash -c bash
```

```sh
scripts/nd bun install --frozen-lockfile
scripts/nd bun run build:bin

# macOS Apple Silicon
scripts/nd ./dist/mitori-darwin-arm64 /absolute/path/to/repository

# Linux x64
# scripts/nd ./dist/mitori-linux-x64 /absolute/path/to/repository
```

`build:bin`は実行環境向けのバイナリを作ります。起動するとローカルURLを表示し、ブラウザを開きます。自動で開かない場合は起動コマンドに`--no-open`を付けます。対象パスを省略すると現在のディレクトリを開きます。

| 環境 | 現在の確認状況 |
| --- | --- |
| macOS Apple Silicon | ネイティブビルド・起動・実LLM修正/Undoを検証済み |
| Linux x64 | ネイティブビルド・バージョン表示・check/unit/goldenをCIで検証済み |
| Windows x64 | クロスビルド済み。Windows上での実行確認は未完了 |

現在のコンパイル対象は上記3種類です。ブラウザはChromium・Firefox・WebKitで検証していますが、実Safariと実際の日本語IME入力は未確認です。

## LLMを設定する

設定画面でプロバイダー・モデル・推論強度を選びます。汎用CLI連携では実行コマンド、出力protocol、単価、タイムアウトを登録できます。任意のLLMを接続する場合は、そのLLMを呼び出すCLIが必要です。

汎用CLIの実行設定は、画面が提示する登録コマンドをローカルのターミナルで実行してから、設定画面で再確認・保存します。実行設定は利用者のグローバル設定で管理し、対象リポジトリから継承しません。

今回の実検証には**Muse `muse-spark-1.3-contributor` / `max`**を使いました。Museプリセットには、認証済みnative binaryのパスと`muse-jsonl` protocolを使用します。LLMは対象リポジトリの設定・hook・ツールを継承しないlean環境で起動します。

汎用CLIは生成・回答・構造化した変更提案に対応します。任意CLIのエージェントツール実行には対応していません。CodexのエージェントモードはMacで検証済みで、未検証のOSでは起動を拒否します。設定・起動条件は[ADR-0015](docs/design/adr/0015-configurable-llm.md)、実LLMの検証手順は[検証記録](docs/progress/continuation-live.md)を参照してください。

## 開発・検証

```sh
scripts/nd bun run check
scripts/nd bun test
scripts/nd bun run golden
```

[PR #5の最終CI](https://github.com/satoki252595/mitori/actions/runs/37355410161)は成功しました。Ubuntuのcheck全7段階、unit 2,944件、golden 109件が成功し、Macのブラウザ検証は344件成功・14件skip、アクセシビリティ検証は8件成功です。性能計測には目標値超過の警告が残っています。[CIの詳細と失敗履歴](docs/progress/pr5-ci-20261005.md)を保存しています。

GitHubの3つのOSS（m3e-canvas、jev-ultrafast、Laya）で実Muse生成とソース照合を行い、誤記を修正しました。1,421件の引用先に無効な参照はありませんでしたが、説明の省略・曖昧さは残り、全文の意味的な正しさを保証するものではありません。[品質検証の結果](docs/progress/oss-quality-2026-10-05/README.md)を参照してください。

## 現在の制約と資料

- Windows上の実行、実Safari・日本語IMEの検証が残っています。
- 初期JSの60KB目標は達成しています。一部の起動時間・メモリ・操作時間などは目標値を超えています。[出荷ビルドの測定](docs/progress/shipping-validation-20261006.md)に測定条件と制約を記録しています。
- Cloudflare共有は任意です。利用する場合にだけ、承認後にデプロイします。
- リポジトリはprivateで、ルートLICENSEは未設定です。一般公開・OSS配布の準備は別途必要です。

最新の引き継ぎは[HANDOFFの冒頭 §★](docs/HANDOFF.md)、残課題は[タスク台帳](docs/progress/backlog-2026-10-05.md)を参照してください。設計は[docs/design](docs/design/)、作業規約は[AGENTS.md](AGENTS.md)と[CLAUDE.md](CLAUDE.md)にあります。
