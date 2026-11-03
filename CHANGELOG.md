# Changelog

## 0.1.0 — 未公開

初回の配布版。GitHub Releases の下書きから配布アーカイブ（`mitori-<version>-<target>.tar.gz`、
Windows は `.zip`）・SHA256SUMS・release.json を取る。検証は `SHA256SUMS` と build provenance
（`gh attestation verify`）で行う。公開（下書き解除）は人が行う。

### できること

- リポジトリ全体を読み、出典付きの日本語設計書（見取り図＋本文）をローカルのブラウザ画面に出す。
- 設計書の箇所へのレビューに、普段の AI が説明・修正提案し、人が確認して未コミットで適用・Undo できる。
- 設計書を HTML ファイルに書き出せる（gzip 圧縮。本文の表示と同内容。対応は Chrome 80+ / Firefox 113+ / Safari 16.4+）。
- 使える LLM（いずれか1つにログイン済みであること）: Claude Code・Muse・Codex・Ollama・LM Studio・Cursor・Antigravity・Grok Build・Grok Build CLI。API キーは不要で、各公式ツールのログインを使う。
- Orca の一覧に合わせた対応: Claude は `claude-haiku-5-5`・`claude-fable-5-1`（価格は 2026-11-03 の公式表）、Codex は effort とモデルごとの価格、Grok Build CLI（`grok-cli`）は画面から単発テキスト生成（既定 `grok-4.7-build-fast`・low）。
- 同じ名前のファイルを区別して表示する。MCP ツール・Rust ルートを入口にする。ホストと同じ target のバイナリは Nix の loader を参照しない（公式 Bun runtime を sha256 固定で使う）。
- 対応 OS: macOS Apple Silicon・Linux x64 / arm64・Windows x64。データの置き場所は `~/.mitori` と対象 repo の `.mitori/`。

### 既知の制限

- macOS バイナリは未署名・未公証のため、初回は Gatekeeper に止められる（`xattr -d com.apple.quarantine` で外す。README 参照）。
- Windows は配布バイナリの自己診断（`mitori doctor`）と選択した操作までを CI で確認。全操作・各 LLM での実生成は未確認。
- 実機の OS レベル日本語変換（IME 確定）の実操作確認は未実施。W3C UI Events・MDN の推奨ガードに照らした実装と自動テスト（Chromium・Firefox・WebKit）は対応済み。
- Codex は確認済みの版（`0.160.0`）だけを自動追従する。別の版に更新された場合は mitori 自体の更新（新しいリリース、またはソースなら `git pull`）が必要。
- Grok Build CLI 経路の既定単価は grok の報告額からの逆算で、公式表ではない。Grok の loop（Explain 回答）経路の timeout は engine に依らない固定値のまま。
- 配布の試運転（build・4 verify）は成功。tag はまだ作っていない（公開は人の判断）。macOS バイナリは未署名・未公証（Apple Developer Program が年 $99 で承認が要る）。
- 小型ローカルモデルでは生成が空になる場合がある（例: Ollama `qwen3:4b` は出力上限を thinking に使い切り本文が空）。モデルとメモリに依存する。
