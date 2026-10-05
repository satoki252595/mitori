# F11: 同じ推計器での入力比較

fresh m3e standard Pass 1（13 calls）の保存済み完全プロンプトを再集計した。追加のモデル呼び出しはない。本文・argv・env・個人の保存先は公開資料に含めず、[照合証明](token-efficiency-comparable.json)に数値、識別子、ハッシュだけを保存した。

| 計算 | 分子 | 分母 | 比率 | 判定 |
| --- | ---: | ---: | ---: | --- |
| 同じ Claude-v5 推計器による別診断 | 296,051 tokens 推計 | 621,491 tokens 推計 | **0.476356** | target 0.5 / limit 0.6 内 |
| 元の conservative byte count 診断 | 692,453 UTF-8 bytes | 621,491 tokens 推計 | **1.114180** | 元の赤を保持 |

比較用分子は既存 `estimateTokensRaw(text, "code", "claude-v5")`。分母は同じ定数・CJK/ceil規則を使う既存 `estimateFromCounts(kindOfFile(...), "claude-v5")`でindex DBの対象87 filesから完全再現した。fresh homeのcalibrationは0件。counter versionと実装source hashを証明へ記録している。**provider exact input usageは未測定**で、両側のtoken数とこの比率は推計である。

13件すべてで内容SHA256とcontent-addressed filename、固定system+packとrun.pinned.systemHash、unique byte countとledger/task、module target/section、requested model、run内時刻、done/attempt1を照合した。run・SHA・indexDigestは既存reportと同じ。曖昧な照合を別taskへ割り当てていない。

再現するCLIは [`bench/measure/oss-token-audit.ts`](../../../bench/measure/oss-token-audit.ts)。入力は既存reportとprivate raw recording directoryの2引数だけで、prompt fileから対応するhomeを特定し、index/state DBをread-onlyで照合する。モデル呼び出し・engine detect・ネット接続は行わない。

```sh
scripts/nd bun bench/measure/oss-token-audit.ts \
  docs/progress/oss-quality-2026-10-05/m3e-token-pass1-final/report.json \
  "<private-raw-dir>"
```

JSONは全guard成功後だけstdoutへ出る。失敗時はexit1・stdout空で、private情報を含まない拒否理由だけstderrへ出る。出力を既存証拠へ保存するときは成功した結果だけを採用する。fresh/uncalibrated・attempt1限定で、cached/retry、分母の再現不一致、記録不足や曖昧な対応を許可しない。

実際の13callを1回再集計し、以前のproofのrun/task/record/hash/bytes/token値とすべて一致した。さらにtemporary copyのraw001が参照するpromptの1文字だけを変更し、`prompt hash mismatch`で拒否（exit1、stdout空）した。元のprivate prompt・reportを変更せず、両確認の成功後だけ公開JSONを保存した。対象ログ `/tmp/mitori-f11-cli-check.log`。対象Biomeはerrors/warningsなし。全体型checkはrootの統合確認で行う。

この診断は経理用 `Usage`、pricing、spend guard、calibration、既存report/[赤い集計](token-efficiency-final/summary.md)を変更しない。genericのbyte数をtoken exactと扱ったり、元の赤い行を緑へ上書きしたりしない。

入力の重複自体は残る。同一repo packは22,693 bytes×13＝295,009 bytes（42.6%）。そのMAPは249,457 bytes（36.0%）で、今回の185 declarationsはexportedのみでprivate/field paddingはない。module SKELETONは90,976 bytes（13.1%）。同じcallのSKELETON/BODIESで重複する50行は1,777 bytesだけで、小さいdedupだけでは元のbyte比を0.6へ下げられない。lockfileの入力N行は0件。これは入力削減の別課題であり、この診断を追加したことで生成の実入力が減ったとは主張しない。
