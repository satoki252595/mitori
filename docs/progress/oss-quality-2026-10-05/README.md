# 最近の GitHub OSS を用いた実 Muse 品質検証（2026-10-05）

3 件の公開 OSS を固定 SHA で解析し、利用者指定の **Muse `muse-spark-1.3-contributor` / `max`** で設計書を生成した。初回と修正後の scoped 実行を別々に保存した。実験のAPI相当推計累計は **$0.487122**、全体cap $1内。最新文書の引用先 **1,421件、範囲無効0件** と全module生成を確認した。これは全文の意味が正しいという判定ではない。

## 選定と実行条件

GitHub API で 2026-09-01 以降の作成、200 stars 以上、非 archive を確認して選んだ。確認時刻・正確な SHA・ライセンスは [selection.json](selection.json)。2026-10-05 に公開リポジトリのページも再確認した。Trending の順位、期間内の star 増加量は取得しておらず、主張しない。

| リポジトリ | 確認時 stars | 対象 | ライセンス |
|---|---:|---|---|
| [lnkiai/m3e-canvas](https://github.com/lnkiai/m3e-canvas) | 8,692 | TypeScript / Next.js の browser canvas | MIT |
| [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | 21,997 | Python の browser agent と Inspector | MIT |
| [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) | 30,713 | 大きい Python 推論基盤と各言語の移植 | Apache-2.0 |

深さ 50、tags / submodule なしで clone し、上流の依存・hook・script・アプリは実行しなかった。Muse は ADR-0015 の native lean profile を使い、空 workspace、認証だけを複写した private profile、shell / write / web tools 無効、worktree 無効、1 model step、1 call 10 分で起動した。各laneの同時 native process は最大 2、最後のm3e fresh Pass 1（C2）とLaya品質修正（C1）の重なる期間は全体で最大3を許可した。`max` は起動引数として記録し、provider の hidden reasoning 量を測定したとは扱わない。

事前の API 相当見積りは合計約 $0.12。各初回 run の cap $0.30、追加品質修正の初期枠 $0.10を、全体cap $1内で対象別見積り・上限を示して追加配分した。F11のfresh standard全生成は既存文書を含まない同SHAの別clone・fresh engine cacheで **13/13、1,704.0秒、$0.083313**（cap $0.12）。入力 $0.10 / 出力 $0.20 / cache read $0.002 per million tokens の設定値と本文 bytes による推計であり、請求額や hidden reasoning token の上限を保証する値ではない。推計が事前値を超えたこと、Layaの旧限定runが最終usageで上限を$0.000095超えたこともreportに保持した。後者の最終guardは修正し、後続runで確認した。

## 初回の結果と再開

| 初回 | 完了 / 対象 | 時間 | API 相当 USD | first-pass valid | retry |
|---|---:|---:|---:|---:|---:|
| [m3e-canvas](m3e-canvas/report.json) | 13 / 13 | 1,774.1 s | 0.074616 | 100% | 0% |
| [jev-ultrafast](jev-ultrafast/report.json) | 11 / 11 | 1,409.0 s | 0.032056 | 100% | 0% |
| [Laya](laya/report.json) | 18 / 21 | 2,702.7 s | 0.141444 | 98.6% | 5% |

Laya 初回は 45 分で中止した。1 module 失敗・2 task 中止を成功に書き換えていない。原因は、正しい 45 文字の section slug を validator が 40 文字上限で拒む実装不整合だった。core の 48 文字制約へ統一し、context に属することと 49 文字以上の拒否は維持した。失敗を再現した回帰テストを追加した（[原因と検証](laya-section-validator-20261005.md)）。

[Laya 再開](laya-resumed/report.json) は失敗 module・§9・§10・§13 の **4 / 4、377.7 s、$0.023751、retry / drop 0**。初回の完了済み module は再生成しなかった。最終文書では全 13 module ページが generated になっている。21 unique task の初回を一括で完走したという意味ではない。

## 品質確認で見つけて修正したこと

- **設計理由:** 主要な構成・trust boundary・明示方針を優先し、局所定数の羅列と推論による禁止を減らした。明示理由と推測を区別する。
- **根拠:** API key の browser 保存と provider への認証送信を混同した m3e の説明、Host / Origin / token を盗聴対策とした Jev の説明を修正した。Node 最小版と CI 使用版、観測単位と実行単位の上限を区別する入力指示も追加した（[ソース照合](semantic-review-20261005.md)）。
- **Jev §9の再確認:** 最新snapshotに複写された初回quality@3の「250候補/run」は、quality@5の限定再生成で削除された。1/1、323.8秒、API相当推計$0.004909（cap$0.03）。60/120の具体値・250DOM候補/観測とscroll/wait追加の説明は入力不足で残らず、POST同時実行数の文言にも範囲の曖昧さがある。原文・失敗履歴を保持し、訂正と説明省略を区別する（[履歴・source照合](jev-quality-correction-20261006.md)）。
- **未解決の問い:** DOCS と cited CLAIMS を質問統合へ渡し、既にコードに答えがある navigation question と module 分割への質問を減らした。最終の m3e 15 問・Jev 8 問・Laya 15 問は `quality.audit.json` の本文と重複検査に記録する。
- **主要フロー:** entry seed が内部候補を全て隠す問題、同 module の別 file へ進めない問題、長い file の先頭だけを本文入力にする問題を共有入力処理で修正・実検証した。import 関係を実 call と断定しない。JevのGETの一般化、LOCK/終了cleanupの混同、履歴と再観測の順序を訂正した。既存stepsの短要約から全keepして訂正されなかったrunも保持し、未ロックstepsだけをsourceから同idで再記述する共有指示へ直した。human lockのkeep/suggestionは維持する。

## 検証が証明する範囲

[quality.audit.json](quality.audit.json) は最新 snapshot の引用先 file / range と全 module ページの状態を検査し、過去の失敗・費用を `runHistory` に保持する。引用先が存在することは文の意味が正しいことを証明しない。L1 の identifier 検査は識別子を含まない文を vacuous とするため、L1 100% だけを意味の正確さとして報告しない。

JevのlatestSnapshotは `jev-quality-final`。§9だけを今回更新し、§3のflows@5/@7と§10のdecisions@6を引き継いだ文書である。最新run名は全節を同じ版で生成したことを意味しない（[節ごとのprovenance](jev-quality-final/provenance.json)）。

[native.audit.json](native.audit.json) は private raw recording から allowlist の metadata だけを書き出す。危険な tools の event は観測せず、終了時と 5 秒後の native 子プロセスは 0。Laya 中止 call の未完了 terminal も残す。記録外の provider 内部動作や実請求を保証する監査ではない。

[m3e最終確認](m3e-comprehension-final-20261005.md)、[Jev最終確認](jev-comprehension-final-20261005.md)、[Laya確認](laya-comprehension-20261005.md)では、全体責務・危険な境界・具体的な機能追加をソースに照合した。資料からの答えとソースで補った答えを分けた。Layaの最新§9はdefault bind `0.0.0.0`と任意API key未設定時の許可、設定時の照合を説明する。Jevの履歴先行保存の理由、choose内部、PRESS_KEYの全変更手順、m3eの条件付き変更先checklistなどの説明不足は残る。実際の新人の理解度や上流モデルの精度・速度を測った実験ではない。

[F11同counter証明](token-efficiency-comparable.md)は、captured fresh Pass 1で296,051 / 621,491 = **0.476356**（target0.5内）。入力側もClaude-v5 raw推計で算定し、経理用の保守的byte比1.1142のredを上書きしていない。provider exact usageは未測定であり、後から改めた全prompt versionのfresh比率をこの値で保証しない。保存DBのflow完了時刻とactual verified claims37/37のquestions入力を照合し、session prep修正によるこのrunの入力欠落を否定した。この懸念を理由とした有料全再測定は実施していない。

## 再現コマンド

```sh
scripts/nd bun bench/measure/oss-fetch.ts
# private config の値や raw recording は Git に入れない。
MITORI_LIVE=1 scripts/nd bun bench/measure/oss-run.ts /path/to/private-muse-config.json
# 既存 home を保って、修正した section だけを --scope で再生成する。
scripts/nd bun bench/measure/oss-quality.ts
scripts/nd bun bench/measure/oss-native-audit.ts
```

実 LLM を再実行する場合は当時の cap / timeout / concurrency と見積りを確認する。native audit の再実行には private raw recordings が必要で、Git に保存した監査結果だけから再監査できたとは表示しない。公開派生文書は上流のライセンスを引き継ぐ資料として各 source SHA とともに保持する。
