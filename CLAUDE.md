# mitori — プロジェクト規約 (Claude Code 向け)

## 概要
リポジトリ/プロジェクトを省トークンで解析し、人が読める設計書を生成。設計書上のレビュー・編集を AI エージェントがコード修正/レビュー対応へ反映する。

## 運用ルール
- 開発環境は flake.nix の devShell(`devShells.default` = ローカル、`devShells.ci` = PR CI)。ツール追加は flake.nix に記載。
- 秘密情報(.env / .dev.vars)はコミットしない。
- Cloudflare リソースは `mitori-` を接頭辞にする。
- 月1000円以上のコスト増になる操作は必ず事前承認。

## コマンド実行
- devShell のコマンドは **`scripts/nd <cmd>`** で実行する(`nix develop --command` は使わない。nd は flake の env を `~/.cache/mitori-nd/<hash>/` にキャッシュし、worktree 間で共有する。起動 ≈40ms)。
- 設計の正本: `docs/design/`(contracts > REVIEW-LOG > ARCHITECTURE/ADR > specs)。作業分割は `docs/design/MILESTONES.md`。**M0 以後、契約の正本は package 側**(`packages/core/src/{domain,api}.ts`、`packages/<pkg>/src/contract.ts`、`apps/web/src/contract.ts`)。`docs/design/contracts/` は凍結スナップショット。

## 開発コマンド(すべて `scripts/nd` 経由)
| やること | コマンド |
|---|---|
| 依存の導入(CI と同じ) | `scripts/nd bun install --frozen-lockfile` |
| 開発ループの関門(並列 ≈1 s) | `scripts/nd bun run check`(tsc -b・biome・境界・CR 台帳・budgets・契約索引・svelte-check。skill `mitori-check`) |
| 単体テスト / golden | `scripts/nd bun test [path]` / `scripts/nd bun run golden [--filter <pkg>]` |
| 整形 | `scripts/nd bun run fmt` |
| fixtures / corpus / budgets | `scripts/nd bun run fixtures:build [--verify]` / `corpus:fetch [--only a,b] [--verify]` / `budgets:merge` |
| バイナリ | `scripts/nd bun run build:bin` → `dist/mitori-<os>-<arch>`(skill `mitori-release-build`) |
| 契約索引・WP brief の再生成 | `scripts/nd bun run contract:index` / `scripts/nd bun run briefs` |
| PR CI と同じ | `scripts/nd bun run ci:pr` |

## パッケージ地図(`PACKAGE_DEPS` = `packages/core/src/domain.ts` §19 が正、`scripts/check-boundaries.ts` が検査)
- `core` 型・純データ・純関数(isomorphic、依存なし) ← 全員
- `platform` Bun/Node API の唯一の置き場(sqlite・hash・spawn・worker・watch・SafeWriter・git) → core
- `indexer`(S0–S4) / `doc`(Markdown⇄block・描画・図) / `agent`(engine・scheduler・台帳) → core, platform
- `anchor`(再アンカー) → core
- `gen`(生成) と `loop`(review・bundle・git 安全・job) → indexer, doc, anchor, agent。**gen ⟂ loop**(互いに import しない、server が配線)
- `server`(daemon・composition root) → 全ドメイン。`client` → core。`apps/cli` → core, platform, client, server。`apps/web`(Svelte 5) → core, client
- `testkit`(test 専用) → 全部。production からは import 禁止(`@mitori/<pkg>/testing` も同様)

## 実装の約束
- 書くのは自分の WP の所有ディレクトリだけ(MILESTONES §1.2)。最初に `docs/design/briefs/WP-xx.md` を読む。
- 公開面は各 sub-directory の `index.ts`(`src/index.ts` は integrator 専用)。M0 の関数は `E_UNSUPPORTED` スタブ: 署名を変えずに中身を実装する。
- 契約の穴は `docs/design/cr-requests/<WP-id>.md` に書き、局所的な回避策に `// CR-PENDING(<WP-id>)` を付ける。台帳は `packages/core/CR-LEDGER.md`。
- ドメインパッケージは port 経由(`SafeWriter`・`Spawner`・`Random`・`Clock`)。`Bun.*`・`node:*`・`Date.now`・`Math.random` を直接使わない。
- テストは実装の隣(`foo.test.ts`)か `packages/<pkg>/test/`。名前の先頭に spec の ID(`IDX-AT-12` 等)。
- Svelte 5 は runes(`$state`・`$derived`・`$props`)、store は `*.svelte.ts` の class。TypeScript は 6.0.3 固定(svelte-check のため)。
- commit は conventional + 末尾に `Co-Authored-By` 行。push・履歴の書き換え・有料 API の呼び出しはしない。
