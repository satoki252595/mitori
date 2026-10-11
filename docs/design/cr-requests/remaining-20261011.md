# 残課題の契約変更（2026-10-11）

利用者の「残タスク全て」「Claudeを使わずCodex」「WindowsもNix経由」の指示を実装する。

- `GenEngineId` に既存 `codex-cli` を含め、既存native adapterの入力・費用 preflight を共有する。新SDK・新auth storeは作らない。実行設定と価格同意は既存CLI承認経路を維持する。
- testkitの既存home helperをtest-only leaf subpathで再利用し、loopの不要なgen再検査を除く。
- Nix-built Windows standaloneを検証runtimeにも使う。Job Object helperは許可env名だけを受け、値をargvへ出さずexact Unicode child envを作る。

採用先・制限は CR codex-gen-1 / CR test-home-1 / CR win-env-1 として `packages/core/CR-LEDGER.md` §17へ記録した。変更PRには `contract-change` を付ける。実行記録は `docs/progress/remaining-20261011/README.md`。
