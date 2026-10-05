# 2. 間取り図 <!-- b_5hmdrn5g -->

floor plan は 3 区分で読み、面積の大きな中心が jev_ultrafast の観測と選択と実行の本体である（[agent.py:12-13](../../jev_ultrafast/agent.py#L12-L13)）。周囲の jev_ultrafast/static のデモ表示は `/api/state` から状態を取って映す（[app.js:56](../../jev_ultrafast/static/app.js#L56)、[app.js:236](../../jev_ultrafast/static/app.js#L236)）。検証用の `scripts` は本体を取り込んで計測と確認と描画を行う（推測）。 <!-- b_ak1270mn -->

```mermaid
flowchart LR
  md_09adeprf["観測駆動エージェント"]
  md_rbvjxg7r["デモ UI 静的資源"]
  md_avzz0ybk["検証用脚本集"]
  md_avzz0ybk --> md_09adeprf
```
<!-- b_n9ndy2m6 -->
