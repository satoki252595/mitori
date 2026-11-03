# Changelog

## 0.1.0 — 未公開

初回の配布版。GitHub Releases の下書きから配布アーカイブ（`mitori-<version>-<target>.tar.gz`、
Windows は `.zip`）・SHA256SUMS・release.json を取る。検証は `SHA256SUMS` と build provenance
（`gh attestation verify`）で行う。公開（下書き解除）は人が行う。

### できること

- リポジトリ全体を読み、出典付きの日本語設計書（見取り図＋本文）をローカルのブラウザ画面に出す。
- 設計書の箇所へのレビューに、普段の AI が説明・修正提案し、人が確認して未コミットで適用・Undo できる。
- 設計書を HTML ファイルに書き出せる（gzip 圧縮。本文の表示と同内容。対応は Chrome 80+ / Firefox 113+ / Safari 16.4+）。
- 使える LLM（いずれか1つにログイン済みであること）: Claude Code・Muse・Codex・Ollama・LM Studio・Cursor・Antigravity・Grok Build。API キーは不要で、各公式ツールのログインを使う。
- 対応 OS: macOS Apple Silicon・Linux x64 / arm64・Windows x64。データの置き場所は `~/.mitori` と対象 repo の `.mitori/`。

### 既知の制限

- macOS バイナリは未署名・未公証のため、初回は Gatekeeper に止められる（`xattr -d com.apple.quarantine` で外す。README 参照）。
- Windows は配布バイナリの自己診断（`mitori doctor`）と選択した操作までを CI で確認。全操作・各 LLM での実生成は未確認。
- 実機の OS レベル日本語変換（IME 確定）の実操作確認は未実施。W3C UI Events・MDN の推奨ガードに照らした実装と自動テスト（Chromium・Firefox・WebKit）は対応済み。
- Codex は確認済みの版（`0.160.0`）だけを自動追従する。別の版に更新された場合は mitori 自体の更新（新しいリリース、またはソースなら `git pull`）が必要。
- 小型ローカルモデルでは生成が空になる場合がある（例: Ollama `qwen3:4b` は出力上限を thinking に使い切り本文が空）。モデルとメモリに依存する。
