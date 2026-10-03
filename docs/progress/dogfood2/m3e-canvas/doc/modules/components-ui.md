# 編集パネル UI（components） <!-- b_1aat8z6d -->

- ファイル 8 · 5469 行 · 重要度 0.29
<!-- b_gkt80trk -->

> [!NOTE]
> **この章で分かること**
> - インスペクタ（右パネル）を構成する共通部品の役割
> - 部品の種類ごとのパネルがどう分担されているか
> - AI 入力欄 `Field` など、変更時に注意すべき点 <!-- b_f60j2pn8 -->

## 責務 <!-- b_e4hvby19 -->

このモジュールは、キャンバス上の部品や画面（フレーム）を編集する側のパネル UI を担う。共通の入力コントロールは `ui.tsx` にあり（[ui.tsx:255-312](../../../components/ui.tsx#L255-L312)）、部品共通の見出しやタブ、トリガー設定は `PartPanel.tsx` にある（[PartPanel.tsx:50-55](../../../components/PartPanel.tsx#L50-L55)、[PartPanel.tsx:70-74](../../../components/PartPanel.tsx#L70-L74)）。種類別のパネルとして `ButtonInspector.tsx`、`PartInspector.tsx`、`FramePanel.tsx` が `Inspector.tsx` から呼ばれる構成である（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)）。キャンバス上の描画そのものは `M3Node` 側の担当である。 <!-- b_hhdwqvys -->

## 公開インターフェース <!-- b_bczp5wv1 -->

- `PanelShell`: ヘッダ、タブ、ロック表示を備えたパネルの外枠（[ui.tsx:27-34](../../../components/ui.tsx#L27-L34)）。
- `IconBtn`: アイコンだけのボタン。`danger` や `on` で配色が変わる（[ui.tsx:255-280](../../../components/ui.tsx#L255-L280)）。
- `Field`: テキスト入力。`multiline`、`grow`、`aiBusy`、`invalid` を持つ（[ui.tsx:607-648](../../../components/ui.tsx#L607-L648)）。
- `Segmented` / `Select` / `Slider`: 選択と数値の入力部品（[ui.tsx:334-341](../../../components/ui.tsx#L334-L341)、[ui.tsx:443-450](../../../components/ui.tsx#L443-L450)、[ui.tsx:985-992](../../../components/ui.tsx#L985-L992)）。
- `Inspector`: 選択中の部品に応じたパネルを出す入口（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)）。
- `PartTabs`: `design` と `behavior` のタブ切り替え（[PartPanel.tsx:50](../../../components/PartPanel.tsx#L50)、[PartPanel.tsx:74](../../../components/PartPanel.tsx#L74)）。 <!-- b_zenpx686 -->

## 落とし穴 <!-- b_dc4p3thh -->

> [!WARNING]
> **落とし穴**
> - `Field` の AI 書き込み演出は `aiBusy` の変化に応じた `requestAnimationFrame` と 320ms のタイマーで制御されるため、フェード用の状態を変えるときは両者を揃える必要がある（[ui.tsx:653-674](../../../components/ui.tsx#L653-L674)）。
> - `Inspector.tsx` と `PartPanel.tsx` は相互に import しており、依存の向きを変えると循環が起きやすい。 <!-- b_zg01qm09 -->
