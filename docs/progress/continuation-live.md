# 続きの実エンジン検証（2026-10-04）

Muse を `generic` の `muse-jsonl` / `{promptFile}` 経由で接続し、実デモと実修復ターンを確認した。
依存追加なし。実行は既存の nix devShell（`scripts/nd`）を使う。

## 設定と事前確認

Settings で native binary とモデル・単価を設定するか、一時設定ファイルの絶対パスを `MITORI_LIVE_CONFIG` に指定する。秘密情報を repo に保存しない。
設定は daemon の一時 `MITORI_HOME/config.json` にコピーされる。デモは `--config` でも指定できる。
`defaultEngine: "generic"`、`engines.generic.enabled: true`、`protocol: "muse-jsonl"`、
`models.answer` / `models.patch` の `generic:` モデル ID が必要。Muse の lean argv は generic adapter が検査する。
agent mode の能力は追加していない。既存の fake / Claude 経路はそのまま使える。

```sh
scripts/nd bun test test/int/int08.live.test.ts -t 'generic live demo dry-run'
scripts/nd bun test/int/shots/live.ts --engine generic --config "$MITORI_LIVE_CONFIG" --max-usd 0.60 --dry-run
```

dry-run は設定と cap を読み、daemon、Chrome、実エンジンを起動せず終了する。完全な設定の検証は daemon 起動時にも行われる。

## 最終デモ

更新された出荷バイナリが必要（`scripts/nd bun run build:bin`）。

```sh
MITORI_LIVE=1 scripts/nd bun test/int/shots/live.ts --engine generic --config "$MITORI_LIVE_CONFIG" --max-usd 0.60 --out docs/progress/live-muse
```

スクラッチの `go-small` で説明1件と Fix1件を実行する。各ジョブの前に、累計の記録値＋見積り×1.5を cap と比較する。
既存のレビュー、60秒以上のブラウザーセッションによる gate 承認、gate 成功後の人の採用、未コミット確認、Undo、
HEAD / refs / stash / worktree / objects が変わらない検査を維持する。スクリーンショットと `measurements.json` を上の出力先へ残す。

## 修復ターンだけ

```sh
MITORI_LIVE=1 MITORI_LIVE_ENGINE=generic MITORI_MAX_USD=0.20 scripts/nd bun test test/int/int08.live.test.ts -t '3\.'
```

`MITORI_LIVE_CONFIG` は上と同じ設定ファイル。generic 選択時は agent mode のケース1、並行ジョブのケース2をスキップし、
ケース3を patch mode に固定する。go test の失敗後に、許可された gate と既存の有界な修復処理を使う。
最後は採用せず reject し、元の作業ツリーのバイト列を保持する。結果は `docs/progress/repair-muse/measurements.json`。
任意の `MITORI_LIVE_OUT` で出力先を変更できる。

初回の回答がそのまま正しいと修復は発生しない。テストが緑でも `repairObserved: false` は修復ターンの検証完了を意味しない。
`final.repairs` と `attempt` の増加、全 gate 成功を確認して実測として扱う。

## cap と実費の区別

デモは $0.60、修復ケースは $0.20 を停止条件として指定した。確定した見積りがこれを越えれば、呼び出す前に止まる。
これはプロバイダーの請求額の保証ではない。設定された単価と取得できた token usage の API 換算値を使う。
単価が不明なら予約 budget、usage が不明なら保守的な token 推定値を記録する。Muse の正確な実費は未測定であり、
0円や上記 cap 以内の実請求を断言しない。
既存の job / repair 上限と、月1,000円以上のコスト増を事前承認する運用も維持する。

## 今回の結果

- 最終デモ: 成功、記録値 USD 0.001128（推計）。`live-muse/measurements.json` と PNG。説明→修正→gofmt/go test/go vet→採用→未コミット→Undo、user repo の refs/objects 等は不変。
- デモの撮影は最終の料金表示修正・Muse一時profile導入より前。デモでも禁止toolの実行は観測0だが、撮影時のComposer料金表示には旧$0表示がある。最終の料金表示は純粋回帰とブラウザーで確認し、撮影のためだけの追加LLM実行はしていない。一時profileの実起動は下の修復で検証した。
- 修復: 成功、記録値 USD 0.001284（推計）。`repair-muse/measurements.json`。attempt1 の go-vet 失敗から cold repair/attempt2、全3gate passed・sandboxed。最後は reject し元の bytes を保持した。
- Muse の両応答は指定モデル、要求 effort max。2 completed terminal、task/operation は model.meta.response のみで tool/hook/reminder/MCP 0。認証だけを一時コピーした無ツール設定の起動を使用した。
- `needs_more_context` は generic の初回・修復・revise 共通で1回だけ補完する。既存 hint resolver、同じWRITEファイル、current head、deny/secret 処理、既存の回数とbudgetを使う。hint は30行まで（既存repairの周辺余白は別途付く）。無償の `test/int/generic-context.test.ts` で初回とrepairを実行した。この最後の実測は追加contextを要求しなかった。
- 実修復のコードは37行を追加し、独自error/整数formatでimport不足を回避した。ゲート成功を変更品質の十分条件にしない。stdlib/既存helperを使う簡潔さは改善余地として残す。

crit再生成（標準・C2・600秒/turn、見積り約USD0.082、記録値cap0.30）:

```sh
MITORI_LIVE=1 scripts/nd bun bench/measure/gen-real.ts --repo "$SCRATCH_REPO" --engine generic --config "$MITORI_LIVE_CONFIG" --effort standard --home "$SCRATCH_HOME" --out docs/progress/gen-muse --concurrency 2 --run --max-usd 0.30 --timeout-min 45 --record "$PRIVATE_RECORD_DIR"
```

`SCRATCH_REPO` は元のcorpusから `git clone --no-hardlinks` した専用clone。`PRIVATE_RECORD_DIR` はrepo外の `/tmp`。provider記録は0700/0600で保存し、認証ファイルの内容を記録しない。CLIがnativeusageを返さない限りcapと実費の差に注意する。

45分で20/24になり、残りのみ同じhome/cloneで継続したコマンド:

```sh
MITORI_LIVE=1 scripts/nd bun bench/measure/gen-real.ts --repo "$SCRATCH_REPO" --engine generic --config "$MITORI_LIVE_CONFIG" --effort standard --scope s3,s11,s12,s13 --home "$SCRATCH_HOME" --out docs/progress/gen-muse --concurrency 2 --run --max-usd 0.1436 --timeout-min 20 --record "$PRIVATE_RECORD_DIR"
```

scoped問いのRAW復元と `gen.risks@3` の品質修正後、最後の2タスクだけを再測定した:

```sh
MITORI_LIVE=1 scripts/nd bun bench/measure/gen-real.ts --repo "$SCRATCH_REPO" --engine generic --config "$MITORI_LIVE_CONFIG" --effort standard --scope s11,s13 --home "$SCRATCH_HOME" --out docs/progress/gen-muse-final --concurrency 2 --run --max-usd 0.09 --timeout-min 20 --record "$PRIVATE_RECORD_DIR"
```

最後の見積りUSD0.004383、記録値USD0.009063推計、2/2成功・283.4秒・2calls。3区間を合わせ24/24、内部retry0%、壁時計再開8.3%、L1 99.6%、27calls・USD0.182344推計。初回120秒失敗を含むcrit総記録値はUSD0.212474。最終の15問・文書・合成方法は `gen-muse-final/README.md`。45分一括完走は未達。全区間で停止直後/5秒後のchildは0、最後の一時認証コピーも0を確認した。token/hidden thinking/請求額は未取得。
