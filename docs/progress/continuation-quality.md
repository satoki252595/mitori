# crit 実生成の品質確認（2026-10-04）

> このcritの結果は履歴として保持する。新しい3 OSSによる実生成・品質改善は [2026-10-05の報告](oss-quality-2026-10-05/README.md)、現在の残りは [HANDOFF §★](../HANDOFF.md) を参照する。

対象は [crit](https://github.com/tomasz-tomczyk/crit) の `406875dd31e0eacc9af33b7643d54100620e8775`。Muse Contributor / 要求 max の生成本文を、元ソースと照合した。引用 L1 は行範囲等の構造検査であり、引用文の意味が正しいことの証明ではない。

## 実測後に直した箇所

1. scoped 継続で問いの RAW が失われた。元runの42問を、現在のAI本文に対応する出力から復元するよう集約を修正した（`49c1575`）。旧module版の問いを新版へ置換し、関係ない履歴を集めない回帰を既存M4で確認した。
2. `gen-muse/doc/11-risks.md:8` の「コメント編集中の再読込抑止が残っている」は、`web/live-mode.sse.js:95-99` の TODO（skipは未実装、現状always reload）を既存の保護のように読める。9行目も `AGENTS.md:44` のVCS subcommands未対応を単なるファイル名への言及に薄めていた。`gen.risks@3` は元の未実装・削除予定・互換対応の状態と具体的な作業を保つ。UNTESTEDから「自動検査なし」「手動必須」と断定せず、確認課題へする指示も追加した（`28388df`）。共通systemと他promptは変更していない。AC-40と既存M4 risksは3件・8assertions成功。
3. `gen-muse/doc/10-decisions.md:27` の「まだ決定はありません」はAIが書いた文ではなく、人がスレッドから記録した `doc_decisions` の静的一覧だった。AIの設計判断と同居する仕様を保ち、空状態文を「スレッドから記録した決定はまだありません」に限定した（`848c4d4`）。日英のReaderと読み取り専用exportを共通文言で修正した。既存のhuman/locked内容を消す処理は追加しない。AI本文との同居、同じslotの決定表更新、human保護、実exportを5件・282assertionsで確認した。

`gen.risks@3` の実再生成では「コメント入力欄にフォーカスがある場合の再読み込み抑止が未実装である」と記述し、元TODOと意味が一致した。「自動検出されず、手動確認が必要」という断定は除かれた。VCS subcommandsの負債はAI一覧から省かれ、静的TODO表の1行抜粋は残る。元の抽出が `AGENTS.md:44` の断片だけを渡すため、周辺文脈を補ってこの負債を正しく説明する改善は残る。すべてのリスクの意味を自動検証できたとは扱わない。

最後の実行はs11/s13の2/2成功。現在本文の43RAWから15問を整理し、`gen-muse-final/doc/13-open-questions.md` から未生成placeholderが消えた。循環依存、アンカー/版管理の整合、共有設定の正本、同意分岐などcritの仕様に向いており、mitoriや提示DATAについての問いは観測しなかった。一方、複数の論点を長い1問へまとめる箇所や「物語」「ブラウザ批評」などの訳語には読みやすさの改善余地がある。NC-20の今回の本文逸脱は見られないが、すべてのrepoで解消したとは扱わない。

## 残る具体例

- `gen-muse/doc/10-decisions.md:13/16/19`: 8判断のうち5件がVCS/sessionの細部に偏る。元 `AGENTS.md:30-40` のfrontend build不要、markdown-itの行対応、レビュー保存/200ms debounce、loopbackと非loopbackの同意、global限定の実行設定など、構造上の判断をより優先する余地がある。
- `gen-muse/doc/modules/web-style.md:20`: 出典無しの役割推測が続く。推測表示はあるが、根拠と確認条件を増やす余地がある。
- `gen-muse/doc/09-quality.md:5/12`: DefaultBranch / ensureFileLoaded / bytesLRUの説明がhotpathとcacheで反復し、識別子の列挙が読みやすさを損ねる。
- 実修復は全gateを通ったが37行の独自error/整数formatterを追加した。stdlib / 既存helperで短くする生成品質の改善は残る。

`gen-muse/doc/00-tldr.md:3` は目的→使い方→構成を短く出典付きで説明している。引用の形式成功率だけでこれらの品質課題を完了扱いにしない。UIラベルのNC-19は本文だけでは判定していない。
