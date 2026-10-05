# 基準機の再校正（2026-10-05）

`scripts/nd bun bench/runner/run.ts --record-reference` は exit 0。既存の校正を5回実行して最小の合計316.229543msを記録した。AC接続、実行前後とも既存の loadavg <= CPU数×0.5 の guard を通過した。全担当の build / typecheck / browser test を一時停止して測定し、条件を満たすまで以前の記録を保持した。

機種・OS・Bun/Node/Chrome・各workload値・記録日時は [reference.json](../../bench/runner/reference.json) に保存した。tree-sitter parse は従来の calibration workload に含まれていない。LLM の推計 token 使用量を校正へ使っていない。

この校正前に実行した UI の結果は当時の reference/factor を記録しており、新しい値を後から適用して合格を作ることはしない。今後の測定は新しい reference を使う。

```sh
scripts/nd bun bench/runner/run.ts --record-reference
```
