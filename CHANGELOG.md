# Changelog

## 0.1.0 — 未公開

初回の配布版。GitHub Releases の下書きから配布アーカイブ（`mitori-<version>-<target>.tar.gz`、
Windows は `.zip`）・SHA256SUMS・release.json を取る。検証は `SHA256SUMS` と build provenance
（`gh attestation verify`）で行う。公開（下書き解除）は人が行う。

### できること

- リポジトリ全体を読み、出典付きの日本語設計書（見取り図＋本文）をローカルのブラウザ画面に出す。
- 設計書の箇所へのレビューに、普段の AI が説明・修正提案し、人が確認して未コミットで適用・Undo できる。
- 設計書を HTML ファイルに書き出せる（gzip 圧縮。本文の表示と同内容。対応は Chrome 80+ / Firefox 113+ / Safari 16.4+）。
- 使える LLM（いずれか1つにログイン済みであること）: Claude Code・Muse・Codex・Ollama・LM Studio・Cursor・Antigravity・Grok Build・Grok Build CLI・Gemini（antigravity-cli、macOS のみ）。API キーは不要で、各公式ツールのログインを使う。
- Orca の一覧に合わせた対応: Claude は `claude-haiku-5-5`・`claude-fable-5-1`（価格は 2026-11-03 の公式表）、Codex は effort とモデルごとの価格、Grok Build CLI（`grok-cli`）は画面から単発テキスト生成（既定 `grok-4.7-build-fast`・low）。
- provider ごとのモデルと effort の選択（WP39）: core の MODEL_CATALOG を setup・web・server が使い、`setup <provider> --list-models` で一覧を出す。web の設定画面の「モデルと推論の強さ」で設定済み engine の中の生成用・回答用の切り替えができる。
- LLM ごとの設定と呼び出しごとの選択（WP41）: 複数の LLM をまとめて登録し、呼び出すたびに選べる。engine ごとのモデル・effort（`engineProfiles`）を `profileFor` で解決し、`setup` は登録と既定の切り替えを分ける（`--default`・`--keep-default`）。web の設定画面で既定の LLM を切り替え、生成の見積もりカードと回答・修正の送信欄の「使うLLM」で選ぶ。`mitori gen --llm <プロバイダー>` でも選べる。e2e はホストで実行する。
- Gemini（WP40〜40h）: agy（Antigravity CLI、サブスク）経由で `antigravity:gemini-3.8-flash`（既定・low）・`antigravity:gemini-4-argon` を使う。呼び出しごとの一時 HOME（キーチェーンの symlink だけ）とツールなし agent 定義で隔離し、prompt は stdin に載せる。生成と回答のみ。ai-job-search 11 タスクで 11/11・L1 93.6 %・190.7 秒・API 換算 $0.539（サブスクのため請求なし）。
- 同じ名前のファイルを区別して表示する。MCP ツール・Rust ルートを入口にする。ホストと同じ target のバイナリは Nix の loader を参照しない（公式 Bun runtime を sha256 固定で使う）。
- 対応 OS: macOS Apple Silicon・Linux x64 / arm64・Windows x64。データの置き場所は `~/.mitori` と対象 repo の `.mitori/`。

### 既知の制限

- macOS バイナリは未署名・未公証のため、初回は Gatekeeper に止められる（`xattr -d com.apple.quarantine` で外す。README 参照）。
- Windows は配布バイナリの自己診断（`mitori doctor`）と選択した操作までを CI で確認。全操作・各 LLM での実生成は未確認。
- 実機の OS レベル日本語変換（IME 確定）の実操作確認は未実施。W3C UI Events・MDN の推奨ガードに照らした実装と自動テスト（Chromium・Firefox・WebKit）は対応済み。
- Codex は確認済みの版（`0.160.0`）だけを自動追従する。別の版に更新された場合は mitori 自体の更新（新しいリリース、またはソースなら `git pull`）が必要。
- Grok Build CLI 経路の既定単価は grok の報告額からの逆算で、公式表ではない。Grok の loop（Explain 回答）経路の timeout は engine に依らない固定値のまま。
- Gemini の単価は第三者のまとめの高いほうで、公式表は未確認（Argon in$4/out$20、Flash in$1.50/out$7.50、thinking は出力扱い）。agy の更新で出力が変わったら `packages/agent/test/fixtures/agy-*` を採り直す。
- 配布の試運転（build・4 verify）は成功。tag はまだ作っていない（公開は人の判断）。macOS バイナリは未署名・未公証（Apple Developer Program が年 $99 で承認が要る）。
- 小型ローカルモデルでは生成が空になる場合がある（例: Ollama `qwen3:4b` は出力上限を thinking に使い切り本文が空）。モデルとメモリに依存する。
