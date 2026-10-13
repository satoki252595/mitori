# 性能の判断と正式測定（2026-10-13 早朝）

main（`1715479`）での測定。生データは [abba-wp16.json](abba-wp16.json)、正式測定は [formal-bench.json](formal-bench.json)。

## ABBA: 性能の候補 `muse/wp16`（`fa437b5`）は統合しない

2026-10-13 04:13〜04:38 JST、main（A）と候補（B）を交互に（A,B,B,A を8巡）。新しいプロセス・空の home、ページキャッシュは捨てる1回で温める。負荷は 1分平均 5.3〜8.3（Orca の Python 1本・iCloud 同期・Spotlight で約4コアが常に使用中。毎回、負荷 7.5 未満が続くのを待ってから測った）。

| 測定 | A 中央値 | B 中央値 | 差の平均（B−A、95 % 信頼区間） | B が良かった巡（速い・少ない） |
|---|---|---|---|---|
| Go 7k（S0–S1、`--shadow`）時間 | 1,468.0 ms | 1,428.3 ms | −19.6 ms（−56.7〜+14.5） | 4/8 |
| React（S0–S4）時間 | 1,193.1 ms | 1,207.2 ms | −2.0 ms（−33.0〜+29.4） | 3/8 |
| React ピーク RSS | 774.8 MB | 794.4 MB | +19.8 MB（+12.9〜+27.9） | 0/8 |

判断: 統合しない。速くならず、RSS が増えた。RSS が増えた理由は、S1 の結果をバッチ完了ごとに適用する分、解析結果を早く保持するためと考えられる（未検証）。ブランチ `muse/wp16` は 2026-10-13 に削除し、記録はタグ `archive/muse-wp16`（`fa437b5`）に残した。試して捨てた案はタグの `docs/progress/wp16.json` にある。

## 正式測定（2026-10-13 04:39、`1715479`、load 6.1〜8.7、`noisy: false`）

| ケース | 中央値 | p95 | 目標 / 上限 | 状態 |
|---|---|---|---|---|
| `idx.s01.cold.7kfiles` | 1,449 ms | 1,486 | 1,200 / 1,500 | WARN |
| `idx.rss.peak` | 792.2 MB | 794.6 | 700 / 1,000 | WARN |

前回（10-12 23:25）は 1,492 ms・774.1 MB。RSS の正式測定は3回の中央値で、上の ABBA の main 側（16回の中央値 774.8 MB）より約 17 MB 高い。回数が少なく、ぶれの範囲と考えられる。

## Mac の 3ブラウザ e2e（ホスト、CI の `browsers` ジョブと同じ手順）

2026-10-13 04:40〜04:46、main `1715479`。`e2e/web` を chromium・firefox・webkit で 386 件成功・失敗 0・省略 14（firefox と webkit の各7件。CLS・初期 JS の大きさ・IME の keyCode 229 の検査は Chromium 専用。WebKit の IME は `ime.webkit.pw.ts` が別にある）、5.3 分。共有の結合テスト（`MITORI_BROWSER_SHARE=1`）2件成功、`@a11y` 8件成功。

## CI の `browsers` ジョブが止まっていた原因

2026-10-12 18:43 JST 以降、`browsers` ジョブの校正は毎回 1.97〜2.20 倍で失敗していた（load 5.5〜8.9 でも。それ以前は 0.96〜1.09 倍）。原因は runner のプロセスが macOS のバックグラウンド優先度（darwinbg、`ps -o pri=` が `4`。通常は `31`）で動いていたことで、Apple Silicon では高効率コアだけで動く。ホストで同じ校正を `taskpolicy -b` で動かすと 1.977〜2.04 倍、通常では 1.135 倍となり、CI の値と一致した。plist は `ProcessType = Interactive` なのに darwinbg になっており、`launchctl kickstart -k` での再起動では直らず（資源のまとまりが引き継がれる）、`launchctl bootout` → `launchctl bootstrap` の登録し直しで `pri 31` に戻った。何が darwinbg にしたかは特定できていない（ゲームモード中に起きた可能性があるが推測のため断定しない）。

対策として、校正の前にバックグラウンド優先度を検出して止める検査（`bench/runner/machine.ts` の `backgroundPriority`、`e2e/web/support/global-setup.ts`）と、基準の誤記録を防ぐ `recordReference` の拒否を入れた。`scripts/install-runner-service.ts` は `bootstrap` の失敗時に短い間隔で再試行する（直後の `bootstrap` は `Bootstrap failed: 5` で失敗することがあるため）。

登録し直した後の再実行（2026-10-13 05:06〜05:11 JST、PR #22）では校正 0.978 倍で通過し、`e2e/web` は 384 件成功・2 件失敗・14 件省略。残った2件は `e2e/web/gen-card.pw.ts:91` の overage の場合（firefox と webkit）で、104 行の強制クリックが本体への入れ替わりの瞬間に当たり `Element is not visible` となったもの。同意前のクリックで POST が無いことの検査が目的で製品の不具合ではないため、テスト側を再試行する形に直した。PR #22 の CI（`1140ed7`）では `browsers` ジョブが成功した（`e2e/web` 386 件成功・失敗 0、校正 0.985 倍）。
