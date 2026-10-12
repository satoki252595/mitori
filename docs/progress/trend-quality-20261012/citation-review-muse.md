# Muse 再生成 2 節の出典照合（2026-10-12、調査のみ）

対象は Muse（muse-spark-1.3-contributor・high）で再生成した2節。Codex 版の照合記録（`../remaining-20261011/quality.citation-review.json`）と同じ形式の機械可読結果は `citation-review-muse.json`。コード変更なし。

- m3e-canvas `lib/tokens`（scope `s6/lib-tokens`、`gen.module@11`）: 主張44
- jev-ultrafast 品質節 §9（scope `s9`、`gen.quality@6`）: 主張22

## 自動判定（report.json）と再計算の一致

自動 L1 集計を `packages/gen/src/verify/l1.ts` の規則（backtick 識別子・引用±2行・scope+親目录・W08 relocate）で主張ごとに再計算し、集計と完全一致した。

| 節 | pass | fail | vacuous | 計 |
| --- | ---: | ---: | ---: | ---: |
| s6/lib-tokens | 37 | 0 | 7 | 44 |
| s9 | 17 | 2 | 3 | 22 |

vacuous の内訳は「引用なし 2（m3e のみ）＋文中に backtick 識別子なし 8（m3e 5・jev 3）」。vacuous は誤りではなく未照合である。

## 人手判定（引用範囲を原文で読んだ結果）

| 節 | 支える | 一部 | 支えない | 推論として妥当（引用なし・推測明示） |
| --- | ---: | ---: | ---: | ---: |
| s6/lib-tokens | 24 | 18 | 0 | 2 |
| s9 | 20 | 1 | 1 | 0 |

- 「一部」は引用の指す記号自体は正しく、主張の内容も原文と一致するが、引用窓が宣言行中心で薄く主張の全体を示さないもの（m3e の型・公開面・手順の多くが該当）。虚偽の内容は見つからなかった。
- vacuous 10 件（両節）はすべて内容が原文と一致した。ただし Markdown 导出では引用リンク付きの通常文として表示され、推測の警告は出ない（Codex 版と同じ注意点）。

## 以前の Codex 版との比較

1. **m3e 依存文の import 原文（解消）**。Codex 版で L1 fail だった `getLang`/`KIND_TEXT`・`schemeFromSeed` の依存文は、今回 `tokens.ts:2-3` の名前付き import 原文を引用し、自動 L1 pass・人手でも「支える」。`ts` は2文字のため照合トークンから除外され、`lib`（親目录）・`i18n`/`color`・記号名で一致する。
2. **m3e 既定値の補完（解消、維持）**。`isPhoneFrame` は `2147-2151` を引用し、`frameSizeOf` による `PHONE_W`/`PHONE_H` 補完を文中で明示している（Codex @11 と同等）。
3. **Jev 品質節の該当箇所（未解消）**。ホットパスの `Agent` 主張は Codex 版と同じ引用（`agent.py:7-9`＋`design.md:5`）で、自動 L1 fail が再現した。`Agent` 識別子が引用窓になく、往復削減を高速化の軸とする部分は推論のまま。人手判定は「支えない」（推論としては妥当）。
4. **Jev の新規 L1 fail が1件**。`record_dir`/`screenshots` の主張（`b_pzvvjk4d` n3）は引用窓（`demo.py:54-61`＋`agent.py:12-35`）に `command`/`reset` の語がなく自動 L1 fail。内容自体は正しく（reset が record を渡し `__init__` が保持する）、`demo.py:44-61` を引用すれば両識別子を含む。人手判定は「一部」。

## 主な誤り・弱さ

- 支えない内容は jev ホットパス n1 の1件のみ（Codex 版と同一パターン）。
- m3e は fail 0 だが、18 件が宣言行中心の薄い窓（特に責務・公開面・データ構造の head 引用・Preview 系）。記号の取り違えはない。
- `b_7x0h09xf` n5 の「薄板 token」は `palette tokens only` の変わった訳だが意味は一致する。

## 判断が必要な点・残った懸念

- Jev ホットパス n1（`Agent` 宣言 12 行を引用窓に入れる等）は入力修正で直る類ではなく、モデルの選択の問題（Codex 版の記録と同趣旨）。検証器を緩めない方針と整合的か確認が必要。
- `b_pzvvjk4d` n3 は引用範囲を1行ずらすだけで自動 L1 が通る可能性が高く、再生成ではなく引用修復の対象に見える。修復方針（W08 relocate は単一引用のみ・この主張は2引用）はオーケストレーター判断。
- 人手の「一部」18+1 件を fail 扱いにするかは定義次第。内容の虚偽はゼロだったため、本報告では fail に数えていない。
- 自動 L1 の主張ごと内訳は生成物の保存 index に残っておらず、本報告用に検証器と同規則で再計算した（集計は一致）。正式な主張ごとの自動値は生成時に保存されていない。
