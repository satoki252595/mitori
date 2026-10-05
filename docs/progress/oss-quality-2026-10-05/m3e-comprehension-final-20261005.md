# m3e 全生成後の変更理解確認（2026-10-05）

[m3e-token-pass1-final の lib-tokens](m3e-token-pass1-final/doc/modules/lib-tokens.md) を pinned source `039ec311acc33dd0c76a54cbc16af4fc8ab9b491` と照合した。以前と同じ「新しい Kind を追加するとき、関連する変更先を資料から見つけられるか」を確認した。生成資料・source の編集、追加 LLM、upstream の実行はしていない。実際の新人による理解度テストや全記述の semantic audit ではない。

**共有入力修正後の fresh 全生成でも、主要な Kind 追加 couplings と4言語の約束は残った。ただし CONTRIBUTING の完全なチェックリストには達していない。**

| CONTRIBUTING:43–49 の変更先 | 今回の module から導ける答え | 残る不足 |
|---|---|---|
| `Kind`、`KIND_SPEC`、`KIND_ORDER`、必要に応じ `sizeOf` / `baseRadii` / `iconSlotsOf` | 落とし穴に新 Kind と `KIND_SPEC` / `KIND_ORDER` / `sizeOf` の同時更新がある。 | `Kind` union 自体への追記は明示せず、`baseRadii` / `iconSlotsOf` も名前が無い。 |
| `lib/i18n.ts` の `KIND_TEXT`、全4言語 | `KIND_TEXT` の4言語を欠かさず追加する、と明示する。 | この項目の主要な約束は残った。 |
| `components/M3Node.tsx`、該当時 `MEASURED` / `NO_BOX` | 描画先と、測定対象なら `MEASURED` の変更を示す。 | `NO_BOX` の条件付き更新は示さない。 |
| `itemJa` / `itemEn` / `itemZh` / `itemKo`、各言語の `STYLE_NOTES` | `lib/prompt.ts` の言語別文と `STYLE_NOTES` を追加する、と示す。 | 4つの producer 名までは列挙しない。 |
| 特殊 editor の `components/Inspector.tsx`、タップ対象の `components/Preview.tsx` | タップ可能なら `Preview.tsx` の対象更新を示す。 | 特殊 editor を追加するときの Inspector は落とし穴に無い。 |

source のチェックリストは [CONTRIBUTING:43–49](https://github.com/lnkiai/m3e-canvas/blob/039ec311acc33dd0c76a54cbc16af4fc8ab9b491/CONTRIBUTING.md#L43-L49)。資料の引用を開けば不足を補えるが、それを本文だけから導けた答えとして数えない。

## sampled residual

- module のエラー処理は `linkUrlOf` が「http 以外」を拒否すると書くが、[tokens:1711–1720](https://github.com/lnkiai/m3e-canvas/blob/039ec311acc33dd0c76a54cbc16af4fc8ab9b491/lib/tokens.ts#L1711-L1720) は `http:` と `https:` を許可し、scheme のない host には `https://` を補う。許可する URL の説明としては不足・曖昧さが残る。
- 不変条件の `isPhoneFrame` は幅・高さが phone 定数に一致するとだけ説明する。[tokens:2147–2151](https://github.com/lnkiai/m3e-canvas/blob/039ec311acc33dd0c76a54cbc16af4fc8ab9b491/lib/tokens.ts#L2147-L2151) は省略された寸法を `frameSizeOf` で phone 定数へ補ってから判定する。欠落寸法を変更するときはこの既定値を source で確認する必要がある。

## snapshot と原価履歴の対応

今回の文書は [m3e-token-pass1-final/report.json](m3e-token-pass1-final/report.json) の run `gr_xzcqec3v`、source SHA `039ec311acc33dd0c76a54cbc16af4fc8ab9b491`、indexDigest `093c4511769c4384` に対応する。既存文書を引き継がない fresh 全生成で **13/13 tasks、1,704.0秒、API 相当推計 $0.083313**。Muse `muse-spark-1.3-contributor` / `max`、13/13 calls が `usageEstimated` で、請求額は unknown。過去の scoped 修正や初回生成の費用と置き換えたり、同じ run として合算したりしない。

構文・引用の集計は first-pass valid 100%、L1 pass 210 / fail 1 / vacuous 91。これは上記の意味上の不足を否定する指標ではない。[同 run の F11 オフライン集計](token-efficiency-final/summary.md) は推計入力 692,453 / filteredTokens 621,491 = 1.1142 で、0.6 limit 未達。今回の主要 couplings の保持と、token 効率・全記述の正確さを別の結果として残す。

## F11 の保存入力と session 修正の影響確認

後の [比較可能な token 集計](token-efficiency-comparable.json) は同じ captured run `gr_xzcqec3v` の保存 prompt を既存 `claude-v5` raw counter で数え、296,051 / 621,491 = **推計比率0.476356** とした。これは上記の usage bytes に基づく旧比率と数え方が異なり、provider の実 token 数ではない。

session の同 phase hard-deps 修正前だったため、questions の CLAIMS から flows が落ちていた疑いを無償で確認した。実行は `POST gen/runs` の push 経路で、保存 DB の同 run に `gen_prep` は0件。questions `gt_3ypse7nzgn` は flows `gt_e5zszcqf1x` を hard dep に持つ。flows は05:12:56.924 UTCに完了し、questions の native call は05:13:06.939 UTCに開始した。保存 doc.index の verified flow claims **37/37** が保存 questions 入力の CLAIMS に全て一致した（`s3`、`s3/prompt-build`、`s3/m3-render`、`s3/boot-editor`）。argv・env・prompt 本文・claim 本文を出力せず、件数・task / section ID・時刻だけで照合した。

この run に session.prepPhase バグ由来の欠落は確認されず、この懸念による fresh 全13 task の追加有料測定は行わない。0.476356 は captured run の結果に限る。後で更新された `gen.flows@7` を含む最新版の fresh 全入力比率を、この旧実測だけで保証していない。production の変更・LLM 起動はこの確認担当から行っていない。
