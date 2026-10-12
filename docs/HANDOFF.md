# mitori 引き継ぎ（現在の状態）

> 最終更新 2026-10-12 JST。これより前の詳しい経緯・測定・判断は [HANDOFF-history.md](HANDOFF-history.md) にそのまま残してある。ここには「今どうなっているか」と「次に何をするか」だけを書く。

## 1. mitori とは

リポジトリを一度だけ省トークンで読み、出典付きの日本語設計書（見取り図＋本文）をローカルのブラウザ画面に出す。人が設計書の箇所にコメントすると、本人の AI（Claude Code / Codex / Muse / Cursor など）がその位置に紐づけて説明・修正提案し、人が確認して未コミットで適用・Undo できる。clone してローカルで使う（Nix・Docker・Cloudflare は通常利用に不要）。

- リポジトリ: `satoki252595/mitori`（private、ルート LICENSE 未設定）
- 使い方: [README](../README.md)、作業規約: [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md)
- 検証状況の詳細: [verification-status.md](progress/verification-status.md)

## 2. 今回（2026-10-12）やったこと

利用者の依頼「残を全て実施」「そもそもの問題があれば解決」「トレンドOSS 3件を Muse high で実行し品質と UI/UX を確認」に対応した。詳細は [trend-quality-20261012](progress/trend-quality-20261012/README.md)。

- **トレンドOSS 3件の実生成**（rea / gods-eye-view / text-to-cad、Muse `muse-spark-1.3-contributor` high）: 全タスク完了・失敗0、出典の存在100 %、主張と出典の一致 92〜96 %。各約44分、API換算の推計 計 約$1.9。
- **利用者目線で見つけて直した問題**（すべて回帰テスト付き）: Codex の利用上限を「予算超過」と誤表示・誤計上／Muse 自動更新で実行ファイルが消えても「インストール済み」／生成中の画面で進捗が0のまま・全体再取得の連発／非Claudeの時間見積りが約3倍楽観的／外部セッションで生成済みでも「未生成」／「動かしてみる」が数百行の表／「主要な流れ」がWebサイトのデモや法務ページを説明／本文の初回表示で「出典 0」と空枠／利用者へNix前提の案内。
- **Go7k コールドスキャン 1,500 ms**: 解析ワーカーのフルGCを若い世代のGC中心に変え、正式ケース中央値 1,431.5 ms で上限内（目標 1,200 ms は WARN）。
- **外部クライアントからの実生成**: Antigravity と Cursor で準備→生成→取り込みを完走。
- **資料の整理**: README を利用者の手順中心にし、検証ログは [verification-status.md](progress/verification-status.md) へ。旧引き継ぎは [HANDOFF-history.md](HANDOFF-history.md) に保存。

## 3. 残っていること

| 残件 | 状態 | 次の一手 |
|---|---|---|
| 実 IME（Chrome で `せってい`→`設定` を変換確定 Enter → 次の Enter で設定が開くか） | 利用者が後日確認すると回答済み。エージェントは OS の入力を操作できない | 利用者の確認を待つ（再依頼しない） |
| Codex での引用の追加2生成（m3e `s6/lib-tokens`・Jev `s9`） | 実行したが提供元の利用上限で即時拒否（課金0）。準備済みの計画は `/private/tmp/mitori-quality-citation-rerun-20261011-Goiu63/plan.json` | 2026-10-18 12:58 以降に `run.sh` を再実行 |
| Grok Build・Codex の外部セッションからの実生成 | Grok は利用残高切れ（402）、Codex は上記の利用上限 | 残高・上限が戻ってから、Antigravity / Cursor と同じ手順で確認 |
| React のピーク RSS（上限 1,000 MB） | 2026-10-12 の同条件で旧 1,019.6 / 新 1,005.9 MB とも僅かに超過（以前 986.7 MB） | Worker 8 本化とのトレードオフ。Worker のメモリ削減か、メモリに応じた本数の検討 |
| 差分再生成で古い「主要な流れ」が残る | rea の §3 は既存の流れの題名が入力に残りデモのまま。text-to-cad は新旧が併存 | 候補から外れた流れを入力から外すか削除提案にする（gen.flows の入力・prompt 変更） |
| 書き出し HTML が大きい | コード抜粋込み 10〜12 MB、抜粋なし 4〜4.5 MB | 抜粋の上限・遅延読み込みの検討 |
| Muse の費用記録と見積りの単位差 | 記録（バイト推計）が見積り（トークン）の約2倍に見える | 見積り側を同じ単位で示すか、表示に「上限推計」と明記 |
| 一般公開 | private・LICENSE 未設定 | 公開範囲とライセンスの判断（利用者） |

## 4. 再開手順

1. `git status --short --branch` と `git log -3 --oneline` で main と差分を確認する。
2. 開発コマンドはすべて `scripts/nd` 経由（[CLAUDE.md](../CLAUDE.md) の表）。関門は `scripts/nd bun run check`、単体は `scripts/nd bun test <path>`、web e2e は `MITORI_E2E_CHANNEL=chrome scripts/nd bunx playwright test -c e2e/web/playwright.config.ts --project=chromium`。
3. 実 LLM を使う検証は、見積りと上限（`--max-usd`）を付けて `bench/measure/gen-real.ts` で行う。費用が月1,000円を超えそうな操作・Cloudflare の deploy / Paid 化・ソフトの直接インストールは事前に確認する。
4. 秘密情報（auth・env・生 prompt・nonce）は Git に入れない。一時ファイルは `/private/tmp` か作業用ディレクトリに置く。

## 5. 守ること（設計の約束）

- AI の変更は「アンカー済み・範囲限定・ゲート済み・人が確認・未コミットで適用・Undo 可」。対象 repo の refs/objects には書かない（side repo、ADR-0012）。
- 自動起動する LLM は lean 起動し、対象 repo の設定・hook・ツールを継承しない（ADR-0013 / ADR-0015）。
- 予算・上限値は根拠なく緩めない。未達は未達として記録する。
