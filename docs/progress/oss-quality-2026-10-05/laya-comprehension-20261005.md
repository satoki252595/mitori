# Laya の生成資料とソースの理解確認（2026-10-05）

対象は `laya-resumed/doc` と、`selection.json` に固定した `8a6e1328cce2460a0e5aa348ad465bb1b5821cd2` の公開ソース。追加モデル呼び出し、upstream のインストール・実行・変更はしていない。資料だけで答えられることと、ソースから補ったことを分ける。実際の新人による理解度テストではない。

| 具体的な変更場面 | 生成資料から分かること | ソースで補う必要があったこと |
|---|---|---|
| HTTP リクエストから判定結果までの処理を直す | [§3](laya-resumed/doc/03-key-flows.md) は認証・admission と Router / Agent の担当を分ける。[Router](laya-resumed/doc/modules/laya-router.md) は route → load → inference → confidence gate → end hook、[Agent](laya-resumed/doc/modules/laya-agent.md) は質問変換・符号化・推論・回答復号を示す。 | §3 の HTTP 手順は `_systemone_inner` の本文読込・入力検証・executor から `router.predict` への委譲を飛ばして `load` の詳細へ移る。[serve.py:1050–1103](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/serve.py#L1050-L1103) の実行経路を確認する必要がある。Router の hook が `ctx.results` を設定すれば推論を短絡できる点も [router.py:1120–1162](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/router.py#L1120-L1162) で確認した。図だけで常に推論を実行すると判断しない。 |
| HTTP サーバーを外部に公開する | [§9](laya-resumed/doc/09-quality.md) は入力規模、SHA 照合、外部入力の扱いを示し、Router ページには `LAYA_HOST` / `LAYA_API_KEY` の入口がある。 | **重要な既定値の説明が不足している。** [serve.py:878](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/serve.py#L878) で key は任意、[serve.py:968–976](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/serve.py#L968-L976) で未設定時は認証を許可し、[serve.py:1282](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/serve.py#L1282) の default bind は `0.0.0.0`。生成資料の key 名だけから認証が必須とは判断できない。key 設定時の health は未認証 caller に liveness だけを返す別境界がある（[serve.py:978–992](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/serve.py#L978-L992)）。 |
| 新しい質問種別を Python と TypeScript に追加する | §0 と各モジュールは `choice` / `score` / `noul`、質問の検証・変換、推論と復号の担当を示す。[§10](laya-resumed/doc/10-decisions.md) は公開 API 変更時に `tests/test_hooks_api.py` を同時更新するという明示方針を取り出している。 | 完全な追加手順には足りない。Python の型番号は [common.py:18](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/common.py#L18)、option 生成は [common.py:106–126](https://github.com/NandhaKishorM/laya/blob/8a6e1328cce2460a0e5aa348ad465bb1b5821cd2/laya/common.py#L106-L126)、型別 scorer / decoding は別処理で、TypeScript の `checkQuestion` と対応も必要。新種別は学習済み checkpoint の契約にも関係するため、列挙定数だけの追加で済むとは扱えない。 |

責務と変更先の入口は得られたが、外部公開の既定値と HTTP 本文処理の具体的な順序には不足があった。上流 README の「100+ 言語」「33 ms」は上流の説明であり、この実験でモデル推論速度を測った値ではない。mitori の生成・引用検証と upstream の推論精度・実行性能は別の検証である。

## 最終 §9 の入力照合と修正（2026-10-05）

[laya-security-final の §9](laya-security-final/doc/09-quality.md) は API key 未設定時の `_authorized` 素通しを明記した。一方、待受説明は `LAYA_HOST` / `LAYA_PORT` の既定を指すだけで、`0.0.0.0` を本文に残していなかった。

private ignored native recording `laya-security-final-raw/001.json` の `--prompt-file` が指す保存済み入力で有無だけ調べた。本文・argv・env・stdin は出力していない。`_authorized` の `api_key is None`（公開 source969行）は BODIES にあったが、`main`1262–1286行と `host=os.environ.get("LAYA_HOST", "0.0.0.0")`1282行は無く、全入力にも `0.0.0.0` は無かった。FACTS にあったのは env 名であり、default address の根拠として十分ではない。

原因は、直前の共通 flow 入力修正で下流 call branch を先にし、単 file の boot / static を残予算へ回した際、品質節が明示的に選んだサーバーの `main` まで後回しになったことだった。`qualityBodies` は優先 main を別の `flowSlices` 呼出しで先に渡し、その後に route bodies を連結する二行の修正で戻した。source schema、6000 token上限、引用・秘密除去、実モデルの指示は変更していない。

既存 parser / pipeline / gather による無償比較では、修正後は `main`1262–1286、default address `0.0.0.0`、optional auth の guard がそろって届いた。source token estimate は **5996**、既存の別計上 omitted marker を含む表示全体は6005。大きな downstream route が同 file main の default bind を押し出す小さい回帰一件を追加し、既存 renderer 全体 **15 tests / 109 assertions**、gen 型検査、所有二ファイル Biome が成功した。

同条件の m3e-canvas 品質入力 hash は前後 `c4af904d4ad47def` と一致し、この修正で既に動く m3e の全生成を再実行しない。Jev 品質入力は demo main が先に入り hash が変わるが、同時に動く Jev の s3 / module scope は変更対象ではない。無償入力確認と、有料再生成後の説明品質は別に扱う。追加 LLM は実行せず、修正後の実出力確認は root が担当する。

## 修正後の実Muse出力

rootは `laya-boundary-verified` で§9だけを再生成した。`gr_weqnefjd`、1/1完了、180.0秒、推計$0.006077、上限$0.012以内。`gen.quality@4` / Muse Contributor max、native child最大1・終了時と5秒後0。最新[§9](laya-boundary-verified/doc/09-quality.md)は待受の既定`0.0.0.0`、APIキー未設定時の素通し、設定時のhmac照合、healthのlivenessだけの例外を対応する行範囲付きで明記した。前節の入力不足と出力省略はこのscopeで解消した。識別子検査5passだけを、他の全段落の意味の正しさと同一視しない。

一つ前の `laya-security-final` は1/1完了したが、終了直前のusage更新で推計$0.007345となり、そのrunの$0.00725上限を$0.000095超えた。過去reportを成功へ書き換えず、`gen-real` は今後最終ledgerでも上限を判定し、完了済みでも超過なら非zero exitと `spendingGuard.exceeded` を返す。
