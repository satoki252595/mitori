# PR #13 統合CI（2026-10-11）

対象headは `23645fdc7100e02e5f6b63bbbde2b33c59b1c79f`。[PR #13](https://github.com/satoki252595/mitori/pull/13)、[CI run](https://github.com/satoki252595/mitori/actions/runs/38115347695)、[機械可読の結果](ci.json)。

Ubuntuの初回は全20projectの意味検査・診断0件だが、checkの補正上限72.49秒を超過した。失敗したUbuntu jobだけを再実行し、check全7項目43.74秒 / hard limit49.79秒、unit3,017pass / 134skip / 4todo / 0fail、golden109pass / 4skip / 0fail、fixtures verify・size・Linux binary buildと`--version`が成功した。soft target24.89秒は未達のまま。上限・較正・検査対象は変更していない。

同headの[Windows run](https://github.com/satoki252595/mitori/actions/runs/38115528185)も成功。[Windowsの実数と証跡](windows-nix.md)を参照。

Macはload11.3823、既定の2回待機後もNOISYで、browser suite開始前のreference guardが停止した。今回のheadのbrowser CI成功とは扱わない。本人がMacをアイドルにできるタイミングを確認中で、guardを外す・較正を書き換える・赤のままマージする操作はしていない。マージと不要ブランチ削除は、この確認後に実施する。
