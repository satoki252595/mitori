# 2. 間取り図 <!-- b_scty1h80 -->

配置図は中央の判定基盤と周囲の移植と道具の依存を矢印で示す（推測）。中央では `Router` が担当を選び `Agent` に渡して回答を返す（[router.py:477](../../laya/router.py#L477)、[agent.py:449](../../laya/agent.py#L449)）。周囲には `laya-ts` と JVM と .NET の推論移植が並ぶ（[README.md:1-3](../../laya-ts/README.md#L1-L3)、[README.md:3-4](../../laya-java/README.md#L3-L4)、[README.md:3-5](../../laya-dotnet/README.md#L3-L5)）。評価群と書き出し道具が検証と計測を支える（[evals.py:262-267](../../laya/evals.py#L262-L267)、[export\_onnx.py:264](../../laya-dotnet/tools/export_onnx.py#L264)）。 <!-- b_ac1gzc99 -->

```mermaid
flowchart LR
  md_qncpqh2z["選定と予測公開"]
  md_ge7t7ryz["判定基盤と評価群"]
  md_sr7gkbyr["書き出しと計測道具"]
  md_avck5t1z["推論エージェント"]
  md_dz71y1h5["ベンチマークと生成スクリプト"]
  md_fjenph5g["動作例とデモサーバ"]
  md_9dbcnw3f["測定証跡と起動準備"]
  md_rj2f1428["TypeScript 推論基盤"]
  md_2qy6k6yh["JVM 推論と回答生成"]
  md_ya0mqphn[".NET 推論エンジン"]
  md_cyq8xgzd["外部連携アダプター"]
  md_mk199cmn["実行見本集"]
  subgraph g_md_8f3b2f11 ["型付き判定基盤"]
    md_qncpqh2z
    md_avck5t1z
    md_cyq8xgzd
  end
  md_sr7gkbyr --> md_qncpqh2z
  md_fjenph5g --> md_qncpqh2z
  md_ge7t7ryz --> md_qncpqh2z
  md_sr7gkbyr --> md_ge7t7ryz
  md_mk199cmn --> md_qncpqh2z
  md_cyq8xgzd --> md_qncpqh2z
  md_sr7gkbyr --> md_avck5t1z
  md_dz71y1h5 --> md_qncpqh2z
  md_avck5t1z --> md_ge7t7ryz
  md_avck5t1z --> md_qncpqh2z
  md_fjenph5g --> md_ge7t7ryz
  md_qncpqh2z --> md_avck5t1z
  md_dz71y1h5 --> md_avck5t1z
  md_mk199cmn --> md_cyq8xgzd
  md_ge7t7ryz --> md_sr7gkbyr
  md_dz71y1h5 --> md_ge7t7ryz
  md_ge7t7ryz --> md_dz71y1h5
  md_mk199cmn --> md_rj2f1428
```
<!-- b_7ax39nbc -->
