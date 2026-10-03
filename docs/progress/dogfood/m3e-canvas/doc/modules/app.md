# エディタ本体（app） <!-- b_s4mw4x2m -->

- ファイル 1 · 4273 行 · 重要度 0.03
<!-- b_hfz8b3xg -->

> [!NOTE]
> **この章で分かること**
> - Editor.tsx がどのような役割を持つか
> - ドラッグやジェスチャを表す状態型の構成
> - 保存キーと環境変数の扱い <!-- b_afg3kb85 -->

## 責務 <!-- b_kdchp8rz -->

`app/Editor.tsx` は単一ファイルで、エディタ本体のコンポーネント `Editor` を既定エクスポートする（[Editor.tsx:453](../../../app/Editor.tsx#L453)）。ドラッグ、パン、範囲選択などの操作状態、履歴、シードデータ、左パネルのタブ定義をここで持つ（[Editor.tsx:171-176](../../../app/Editor.tsx#L171-L176)、[Editor.tsx:190-239](../../../app/Editor.tsx#L190-L239)、[Editor.tsx:441-451](../../../app/Editor.tsx#L441-L451)）。部品の描画や各種パネルは `components` と `lib` に任せ、このファイルはそれらを組み合わせる（推測）。 <!-- b_p0s8exdh -->

## 公開インターフェース <!-- b_62a3znew -->

- `Editor({ initialLang, onReady })` は初期言語と準備完了コールバックを受け取る既定エクスポートである（[Editor.tsx:453](../../../app/Editor.tsx#L453)）。 <!-- b_58hyzwcd -->

## データ構造 <!-- b_pb27t0mw -->

- `DragState` はドラッグ中の部品、開始位置、ガイド、ごみ箱上かどうか、スナップ、消滅中かを持つ（[Editor.tsx:190-212](../../../app/Editor.tsx#L190-L212)）。
- `Gesture` は `pan`、`marquee`、`frame`、`group` の 4 種の判別共用体である（[Editor.tsx:214-234](../../../app/Editor.tsx#L214-L234)）。
- `Snapshot` は `groups`、`frames` と任意の `meta` を持ち、履歴の単位になる（[Editor.tsx:237-239](../../../app/Editor.tsx#L237-L239)）。 <!-- b_y20h660b -->

## 設定 <!-- b_630qk97c -->

- 環境変数 `NEXT_PUBLIC_BASE_PATH` を読む（[Editor.tsx:140](../../../app/Editor.tsx#L140)）。
- 保存キーは `m3e:doc`、`m3e:doc:before`、`m3e:doc:editor`、`m3e:ui` である（[Editor.tsx:172-176](../../../app/Editor.tsx#L172-L176)）。 <!-- b_s15ccpef -->

## 落とし穴 <!-- b_k5y25n1w -->

> [!WARNING]
> **落とし穴**
> - 履歴の上限は `HISTORY_MAX` の 100 件である（[Editor.tsx:171](../../../app/Editor.tsx#L171)）。
> - 位置は `GRID` の 4px 単位に揃える `onGrid` を通る（[Editor.tsx:186-187](../../../app/Editor.tsx#L186-L187)）。 <!-- b_xx87pqw2 -->
