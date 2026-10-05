# Laya の module section 検証不一致（2026-10-05）

対象は `md_mk199cmn` / `s6/examples-laya-dotnet-samples-laya-ts-examples`。公開 OSS の生成応答だけを抽出し、live SQLite は read-only で照合した。argv、env、prompt 本文は出力・保存していない。追加 LLM 呼び出しなし。

## 観測

`gen_tasks` の task `gt_ag1tcw5ba8` / run `gr_v9d9bk91` は attempt 2 で `E_GEN_COVERAGE_LOW`、responsibility/interface 欠落と記録された。

| 応答 | 行 | 型・aspect | section | 当初の検証 |
| --- | --- | --- | --- | --- |
| laya-raw/013.json（attempt 1） | 3 / 4 | block responsibility / interface | 省略（compact） | 有効 |
| 同上 | 19 / 20 | question | task と同じ45文字 slug | V05 |
| laya-raw/014.json（attempt 2） | 1 / 2 | question | task と同じ45文字 slug | V05 |
| 同上 | 3 | end | — | W05 |

どちらも `payload.kind=run_terminal` の `payload.text` 内の行メタデータから特定した。第2応答は questions 2行と end のみ。要求された修復差分に沿っており、節名をモデルが誤った事例ではない。

## 根因と修正

core の `SLUG_RE`、indexer/doc の module slug 上限は48文字だが、gen line validator の節名 regexp は40文字だった。正しい45文字の明示 section を拒否した。

さらに `execute.ts` の cold diff retry は第1応答の accepted 値を `replayAccepted` で新しい validator に再投入する。この値は section が補完済みなので、初回は section 省略で通った responsibility/interface も同じ V05 で再投入時に拒否された。再投入の負の行番号は `gen_lines` に保存されず、最終 coverage だけが欠落を報告した。

`validator.ts` の節名形式を共通 `SLUG_RE` に揃えた。block、question、質問集約、再投入に同じ判定を適用する。許可済み task sections への照合と dynamic flow key の32文字上限は維持。bare suffix / appended aspect の補完にも形式判定を適用し、49文字の不正な context section がその補完経路を通らないようにした。generic adapter、retry orchestration、責任/interface 要件、prompt version は変更していない。

## 検証

追加回帰3件は修正前に全て失敗した。修正後の `scripts/nd bun test packages/gen/src/line/validator.test.ts` は **46 pass / 0 fail / 578 assertions**。

- 45 / 48文字の明示 block / question を受理。
- 49文字の exact / bare suffix / appended aspect、および有効形式でも task 範囲外の節を拒否。
- compact の責任/interface を normalized 値として cold diff に再投入しても coverage を維持。

`scripts/nd bunx tsc -p packages/gen --noEmit` は成功。対象2ファイルの Biome は整形後成功。実 LLM の再測定は root が既存 full run 終了後の failed module のみに限定して行うため、この資料はその結果を先取りしない。
