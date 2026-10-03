# mitori 引き継ぎ資料（2026-10-04 停止時点）

> ユーザーの指示（コスト抑制）により、グループ B の並列ワークフローを途中で停止した。
> **main は緑（check + 2,144 tests pass）で安定**している。グループ B の成果は未検証のまま `track/*` ブランチに退避してある（main には未マージ）。

---

## 1. プロダクト概要（1 分で）

**mitori（見取り図）** — リポジトリを一度だけ省トークンで読み、人が読める「設計書」を生成する。設計書の任意の箇所にコメントすると、**ユーザー自身の AI エージェント**（Claude Code / Codex）が最小コンテキストでコードと設計書を同時に直し、差分と費用を返す。ローカルファースト、日本語ファースト、Bun 単一バイナリ。

- 参考: lnkiai/m3e-canvas（設計→AI 向けプロンプト）、tomasz-tomczyk/crit（レビュー→エージェントへフィードバック）
- 差別化: 設計書アンカー型の閉ループ / 全 claim に出典と検証バッジ / 初心者〜専門家を 1 文書で / 費用の事前見積→上限→実績 / 日本語組版
- リポジトリ: `github.com/satoki252595/mitori`（private）

## 2. 停止時点の状態

### 2.1 main（安定・push 済み）

| 項目 | 状態 |
|---|---|
| 最新 | `docs: handoff` コミット（この文書）。直前 `7b4bcba feat(core): CR batch 2` |
| ゲート | `scripts/nd bun run check` 緑 / `scripts/nd bun test` 2,144 pass・0 fail（約 2 分） |
| 完了マイルストーン | M0（土台・契約凍結）、M0.5（walking skeleton）、M1（0 トークンの見取り図）、M2 の大半（生成パイプライン・セッションエンジン）。詳細 `docs/progress/M1.md` |
| 動くもの | `mitori <path>` → daemon 起動 → S0〜S4 解析 → 静的設計書（間取り図・目次・facts 表・§4/§5/§6/§8/§11）をブラウザ表示（**0 トークン、crit 1,219 files で 1.05 s**）。⌘K、ライト/ダーク、ファイル保存→鮮度バッジ、生成の見積→実行→ブロック streaming（録画エンジンで検証済み）、`.mitori/` への書き出し（GitHub で出典リンクが効く）、`mitori gen --prep/--ingest` |
| 動かないもの（main では） | レビュー→AI 修正ループ（`createLoop` 未マージ）、Pull CLI（`mitori review` 等）、差分更新 S9、HTML export。初回起動で claude CLI が「見つかりません」になる（修正は track/dogfood にある） |

### 2.2 グループ B の退避ブランチ（未マージ・未検証）

各トラックは「実装 → 敵対的検証」の **実装段階の途中**で停止。検証エージェントは未実行。`wip(...)` コミットは停止時点の未コミット作業をそのまま保存したもの。

| ブランチ | 内容 | `bun run check` | 次の作業 |
|---|---|---|---|
| `track/dogfood` | **実エンジン生成の修正一式**: 初回 claude 検出（TOFU pinning）、**プロンプトが 2 回送られトークン 2 倍になるバグ修正**、プロセス残留修正、プロンプト @2〜@4、L1 検証改善、見積に再試行分を加算、`bench/measure/gen-real.ts` | ✅ | **最優先でマージ**（検証 → main）。gen-measure レポートは未作成（数値は §3.2） |
| `track/11` | WP-11 CLI 一式（review/bundle/reply/touch/open/check/digest/gen/install/mcp/config/export/usage/stop/doctor）、Pull hook、installer、MCP tools/list golden、進捗レポート | ✅ | 検証 → マージ。daemon 側の配線待ち項目はブランチ内レポート参照 |
| `track/06b` | WP-06b: S9 差分更新、on-demand、翻訳、M4 prompt 5 本、crit 40 commit replay テスト | ✅ | 検証 → マージ |
| `track/perf` | 増分 S2 facts、wasm モジュール共有、watcher の stat 判定・ディレクトリ削除、永続化の非同期化（+ wip: GitReader local） | ✅ | 検証 → マージ。gostd の時間/RSS 予算は再計測が必要 |
| `track/10b` | WP-10b レビュー UI（選択ツールバー・Composer・ジョブ/ready カード・Review パネル・Inbox）+ wip（遅延ロード化、e2e/loop） | ✅ | 検証（Playwright でスクショ確認）→ マージ |
| `track/visual` | 見た目の磨き込み（地図ラベル切れ、ヒーロー、生成カード状態、Reader の重複見出し・表、i18n）— **全部 wip**（53 files） | ✅ | 検証（スクショ比較）→ マージ |
| `track/08b` | WP-08b git 安全（side repo・snapshot・scope・accept/undo・gc）+ wip（gates・jobs・createLoop 相当） | ❌（tsc 未使用変数 1、biome 25） | 修正して検証 → マージ。**これがマージされるとレビュー→修正ループが動く** |
| `track/structure` | S3 のディレクトリ整合 leaf、パス名、module/repo skeleton、moduleContext、要約 + wip（cluster 調整・テスト） | ❌（biome 4） | 修正して検証 → マージ。巨大モジュール問題（crit で 35.7k 行が 1 module）の解消確認 |

推奨マージ順（依存と衝突の少なさ）: `dogfood` → `perf` → `structure` → `06b` → `08b` → `11` → `visual` → `10b`。マージ後に `packages/server/src/compose.ts` へ `createLoop`（08b）と 06b の入口を配線する（WP-INT の仕事。`docs/design/briefs/WP-INT.md`）。

## 3. 実測値

### 3.1 解析・UI（M1、Apple M5 Max、他エージェント稼働中）

| 指標 | 予算 target / limit | 実測 |
|---|---|---|
| 起動 → 最初の有用な画面（crit） | 3 s / 5 s | **1.05 s**（m3e 0.56 s） |
| S0〜S4 + 静的文書（crit） | 1.0 / 2.0 s | 0.80 s |
| 保存 → 鮮度バッジ | 50 ms / 1 s | go-small 30 ms、crit 80〜140 ms |
| 初期 JS（gz） | 60 KB 警告 / 150 KB | 83〜84 KB |
| バイナリ | 85 / 95 MB | 68.8 MB、`--version` 26.6 ms |
| gostd cold / peak RSS | 1.5 s / 1 GB（limit） | 2.0 s / 1.05 GB（**超過**、track/perf で対処中） |

### 3.2 実エンジンでの標準生成（track/dogfood、lean `claude -p`、Max サブスク、並列 3）

| repo | 所要 | 最初の AI ブロック | API 換算 | 入力（うち cache read） | 出力 | citation L0 / L1 |
|---|---|---|---|---|---|---|
| crit（65k 行） | 145 s | 2.7 s | **$1.32** | 828k（65%） | 37k | 100% / 84.8% |
| m3e-canvas | 94 s | 4.3 s | **$0.52** | — | — | — |

- 初回 run は「プロンプト 2 重送信」バグで CLI 実費 $3.88（台帳 $1.88）・子プロセス 33 本残留 → 修正済み（track/dogfood）。
- 課題: 行の再試行率 63%（費用の主因）、見積誤差 +84%（再試行分を見積に加算する修正は入った）、L1 が limit 85% をわずかに下回る。
- 生成された実物の設計書: `docs/progress/dogfood/{crit,m3e-canvas}/doc/*.md`（品質確認用）。

## 4. 既知の課題（優先度順）

1. **レビュー→修正ループが main で動かない**（08b + 10b + 11 のマージと配線が必要）。MVP の「魔法の瞬間」はここ。
2. **モジュール分割が粗い**（crit で 1 module 35.7k 行、名前が `internal + cmd · CritJSON`）→ track/structure。
3. **間取り図の見た目**（ラベル切れ・空箱・常時出る「間取り図にできない構成」バナー）、ヒーロー/生成カード/Reader の表 → track/visual。
4. 生成の再試行率 63% と見積誤差（§3.2）。
5. gostd 規模の解析時間・メモリ超過、crit の鮮度バッジ 80〜140 ms。
6. Linux 未計測（watcher 方式 O3 含む）、Windows 未対応。
7. 未着手: WP-08c（agent mode・test gate・修復）、WP-13（HTML export）、WP-17（Cloudflare 共有、**デプロイ前にユーザー承認必須**）、WP-18（床面図）、公開ベンチ・初見者理解テスト。

## 5. 再開手順

### 5.1 環境

```bash
cd ~/work/20261002_aiAgentTool
scripts/nd bun install --frozen-lockfile   # nd = キャッシュ済み nix devShell で実行（nix develop は使わない）
scripts/nd bun run check                   # typecheck + biome + 境界 + CR 台帳 + budgets + svelte-check
scripts/nd bun test                        # 全テスト（約 2 分）
scripts/nd bun run build:bin               # dist/mitori-darwin-arm64
./dist/mitori-darwin-arm64 <repo-path>     # ブラウザで見取り図が開く
```

- コーパス（ベンチ用 clone）はセッション一時領域にあった。再取得: `scripts/nd bun scripts/fetch-corpus.ts`（`bench/corpus.lock.json` の pin で shallow clone）。
- 実エンジン生成の計測: `.claude/skills/mitori-measure/`（`MITORI_LIVE=1` と `--max-usd` が無いと 1 円も使わない設計）。

### 5.2 ブランチの取り込み（コストを抑えたやり方）

1 ブランチずつ、手元で:

```bash
git checkout -b integrate/dogfood main
git merge --no-ff track/dogfood
scripts/nd bun run check && scripts/nd bun test
```

失敗したら原因をそのブランチで直してから main へ。08b / structure は lint エラーがあるので `scripts/nd bunx biome check --write <path>` と未使用変数の修正から。

### 5.3 推奨する次の一手（コスト順）

1. **（ほぼ無料）** `track/dogfood`・`track/perf`・`track/06b`・`track/11` は check 緑。テストを通してマージ。
2. **（小）** `track/08b`・`track/structure` の lint 修正 → テスト → マージ → `compose.ts` に `createLoop` 配線 → INT-06（デモ台本: Explain → Fix → 採用 → Undo → `mitori review`）を録画エンジンで通す。
3. **（中）** `track/10b`・`track/visual` をスクショで確認してマージ。
4. **（中〜大、LLM 費用あり）** 実エンジンでデモ台本を 1 回（go-small、API 換算 $0.5 以下）。初見者理解テスト（`docs/design/specs/testing.md`）。

### 5.4 コストについて（今回の反省と次回の運用）

- 今回は ultracode（多数エージェントの並列ワークフロー）で進めた。サブエージェントの消費トークンはおおよそ: リサーチ 3.2M、設計 10.3M、M0 2.1M、グループ A 14.5M、グループ B（停止まで）数 M〜10M 規模。**設計フェーズの仕様が 2MB と過大**で、各エージェントの読み込みコストを押し上げた。
- 次回の目安:
  - 並列は 3〜4 本まで、検証は「失敗した受け入れ試験がある WP だけ」に絞る。
  - 定型作業は sonnet、opus は設計判断・セキュリティ・統合だけ。
  - 各エージェントは `docs/design/briefs/WP-xx.md`（≤ 12k token）だけを読み、spec 本文の全文読みを禁止する。
  - 実エンジン生成は 1 repo あたり API 換算 $0.5〜1.5（サブスク枠から消費。継続的な課金増は無し）。
- 継続費用: **0 円**（Cloudflare 未デプロイ、GitHub Actions は push トリガー無し・未実行）。

## 6. ドキュメント地図

| 何を知りたいか | どこ |
|---|---|
| 調査の結論（競合・数値・方針） | `docs/research/00-synthesis.md`（Critic addendum を含む） |
| アーキテクチャ・判断 | `docs/design/ARCHITECTURE.md`、`docs/design/adr/0001〜0014` |
| 作業分割・受け入れ試験・所有ディレクトリ | `docs/design/MILESTONES.md`、各 WP の要約 `docs/design/briefs/WP-xx.md` |
| 仕様の優先順位 | 契約（`packages/*/src/contract.ts`、`packages/core/src/{domain,api}.ts`）> `docs/design/REVIEW-LOG.md` > ARCHITECTURE/ADR > `docs/design/specs/*.md`（各 spec 冒頭「改訂 R1」が本文に優先） |
| 契約変更の台帳 | `packages/core/CR-LEDGER.md`、未処理の要望 `docs/design/cr-requests/` |
| UI の正解（目標の見た目） | `docs/design/prototypes/editorial/`（index.html + shots）、統合仕様 `docs/design/prototypes/JUDGEMENT.md` §6 |
| 進捗・実測 | `docs/progress/M1.md`、`docs/progress/m1/*.png`、`docs/progress/dogfood/` |
| 開発コマンド・規約 | `CLAUDE.md`、`.claude/skills/{mitori-check,mitori-bench,mitori-measure,mitori-release-build}` |

## 7. 守るべき約束（設計で決めた安全側の既定）

- エージェント起動は lean flags 必須（`--setting-sources ""`/`--strict-mcp-config`、stdin でプロンプト、`--system-prompt-file`、`--no-session-persistence`、完全なモデル ID）。**対象 repo の project 設定・hook を読ませないのはセキュリティ境界**（invariants I1〜I14、`packages/agent`）。
- サブスクで `claude -p` を使う扱いは 2026 年に 3 回変わっている（ADR-0005）。並列は既定 3、無人ループなし。
- ユーザー repo の refs/objects/worktree には書かない（side repo、ADR-0012）。accept は未コミットで作業ツリーへ + checkpoint で Undo。
- `fixtures/repos/{injection,secrets}` には**意図的な偽の秘密情報**がある（スキャナ試験用）。
- Cloudflare リソースは `mitori-` 接頭辞。**デプロイ・Paid 化は事前承認**。
