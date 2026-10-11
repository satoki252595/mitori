# PR #13 統合CI（2026-10-11）

対象headは `23645fdc7100e02e5f6b63bbbde2b33c59b1c79f`。[PR #13](https://github.com/satoki252595/mitori/pull/13)、[CI run](https://github.com/satoki252595/mitori/actions/runs/38115347695)、[機械可読の結果](ci.json)。

Ubuntuの初回は全20projectの意味検査・診断0件だが、checkの補正上限72.49秒を超過した。失敗したUbuntu jobだけを再実行し、check全7項目43.74秒 / hard limit49.79秒、unit3,017pass / 134skip / 4todo / 0fail、golden109pass / 4skip / 0fail、fixtures verify・size・Linux binary buildと`--version`が成功した。soft target24.89秒は未達のまま。上限・較正・検査対象は変更していない。

同headの[Windows run](https://github.com/satoki252595/mitori/actions/runs/38115528185)も成功。[Windowsの実数と証跡](windows-nix.md)を参照。

Macはload11.3823、既定の2回待機後もNOISYで、browser suite開始前のreference guardが停止した。guardを外す・較正を書き換える・赤のままマージする操作はしていない。

## head6af11b8での後続

資料のみを追加したhead `6af11b8c27394435e860132cf87179c4198356a9` の[CI run](https://github.com/satoki252595/mitori/actions/runs/38116332962)もUbuntuは成功。Mac初回はload10.0303でguard停止、次のjobはload7.7891だがfactor1.107595で既存の±10%範囲外だった。再実行対象は失敗したMac jobだけとした。

[Mac job114404755569](https://github.com/satoki252595/mitori/actions/runs/38116332962/job/114404755569)はload8.4214 / quiet / AC / factor1.053251で既定guardを通過し、実browser suiteを実行した。結果は369pass / 14skip / 5fail（8.8分）。Chromiumのroom card最大226.6ms（上限100）、level切替p95107.9ms（上限50）、TOC遷移p95242.4ms（上限100）が失敗。ChromiumとWebKitでは、streaming完了節の予約解除後に読書位置が1,546.625px移動し、上限4pxを超えた。共有viewer / a11yの後続stepは未実行。単なるguard停止ではなく、これらの失敗を修正・限定再検証してから統合する。

## 読書位置の最小修正と限定回帰

同じページのrefreshがGET /ui待機前の読書位置を復元していたため、DOMを置き換える直前に同page / workspaceの現位置を取り直す。加えて、`content-visibility:auto`で描画を省略された節の子要素が古い矩形を返し、画面内のanchorと誤認されていた。共有captureAnchorで `checkVisibility({contentVisibilityAuto:true}) === false` の要素を飛ばす。API未対応時の経路、既存fallback、4px上限は維持した。製品変更は合計7行。

新しいpending通信中の移動回帰は旧動作で約4,497pxずれ、修正後はChromium / Firefox / WebKitすべて成功（3件 / 4.6秒）。描画省略節の回帰も旧動作がb_skippedを誤選択し、修正後は実CSSでb_visibleを選び3件 / 3.8秒成功した。元のstreaming試験9件も3browserすべて成功、CLS0。web / e2e型検査と対象4file Biomeは成功。一時診断はすべて復元し、streaming試験・入力・mark・上限を変更していない。

既存Chromium時間試験3件の限定診断は3pass / 4.8秒。card31〜47ms、open21〜33ms、level1.5〜12.1ms、TOC32〜49ms。ただしload11.99でreference条件外なので、正式CI成功へ読み替えない。levelのinput→rAF予約は1〜3ms、rAF待ちは0〜10.7ms、TOCは予約19〜24ms / rAF待ち12〜24.6ms。CIで見えた100ms成分はここでは再現せず、原因をcompositorと断定していない。統合headの元のCI gateで再確認する。

引用入力・Go Node.type・読書位置の修正を含む統合checkは全7step成功（4.18秒、warm）。配布Mac binaryのSHA-256は `8d1f22762b6b56d9eae7181e61a144b1d8e607f1ff84808b9d9673d51387deb7`、embedded selftest6checks成功（1,075ms）。[strict assets](reader-fix-assets.json)全項目成功、初期JS54.697KB gzip / target60KB。正式CIの代わりには扱わない。

## 修正後head98c59a6

[CI run38119108193](https://github.com/satoki252595/mitori/actions/runs/38119108193)のUbuntuは成功。check全7項目63.04秒 / hard limit68.30秒、全20semantic builds / 0cached / 0errors。unit3,022pass / 134skip / 4todo / 0fail（121,956 assertions）、golden109pass / 4skip / 0fail（1,028 assertions）、fixtures verify・size・Linux binary build / versionが成功した。soft target34.15秒は未達のまま。

Mac初回job114409967855はload9.7925でNOISY。失敗したMac jobだけ再実行した[job114412318444](https://github.com/satoki252595/mitori/actions/runs/38119108193/job/114412318444)はload8.4741 / quiet / ACだがfactor2.308816が既存0.9–1.1範囲外で、browser suite開始前に停止した。Ubuntuを再実行せず、上限・較正・基準機referenceは変更していない。旧headの5失敗は履歴として保持し、修正後の正式Mac suite成功とは扱わない。PR #13は未マージ。

3回目も失敗したMac jobだけ再実行。[job114416752978](https://github.com/satoki252595/mitori/actions/runs/38119108193/job/114416752978)はload8.9409 / quiet / AC、factor1.899867が範囲外でbrowser開始前に停止した。dispatch直前のroot側はload8.5039 / factor1.084268だったが、別時点の測定なのでCIの合格や遅延原因の証明にしない。共有viewer / a11yの後続stepも未実行、Ubuntuの成功は保持した。
