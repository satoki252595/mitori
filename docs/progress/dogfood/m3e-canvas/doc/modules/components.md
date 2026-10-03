# 共通UIと多言語辞書 <!-- b_k5xe45ph -->

- ファイル 19 · 5830 行 · 重要度 0.82
<!-- b_efqt0900 -->

> [!NOTE]
> **この章で分かること**
> - このモジュールが担う共通 UI 部品と多言語辞書の役割
> - `lib/i18n.ts` の言語切替と辞書の構造
> - `app/page.tsx` による Editor の遅延読み込み <!-- b_h1v6tbzh -->

## 責務 <!-- b_x3m1hy8t -->

このモジュールは、エディタ全体で使う汎用 UI 部品（`components/ui.tsx`）、ツールバーやメニューなどのパネル、4 言語の文言辞書（`lib/i18n.ts`）、テーマとフォントの読み込み（`lib/theme.ts`）、アプリの入口（`app/`）をまとめる（[i18n.ts:5-6](../../../lib/i18n.ts#L5-L6)、[i18n.ts:22-23](../../../lib/i18n.ts#L22-L23)）。 部品の描画や Group の整頓などの編集ロジックは、依存先の別モジュールが持つ（推測）。 <!-- b_qa0e4qmh -->

## 公開インターフェース <!-- b_86eeetv4 -->

- `Lang` / `LANGS` / `isLang`：対応言語 ja・en・zh・ko の型、一覧、型ガード（[i18n.ts:5-6](../../../lib/i18n.ts#L5-L6)、[i18n.ts:12](../../../lib/i18n.ts#L12)）。
- `t(key, lang)`：`UI` と `KO` から文言を引く（[i18n.ts:574](../../../lib/i18n.ts#L574)）。
- `useLang` / `LangContext`：現在の言語を React で共有する（[i18n.ts:22-23](../../../lib/i18n.ts#L22-L23)）。
- `ThemeContext` / `useTheme`：`Theme` を共有する（[theme.ts:9-10](../../../lib/theme.ts#L9-L10)）。
- `PanelShell`、`IconBtn`、`Segmented`、`Field`：パネル用の共通部品（[ui.tsx:27-34](../../../components/ui.tsx#L27-L34)、[ui.tsx:255-262](../../../components/ui.tsx#L255-L262)、[ui.tsx:334-341](../../../components/ui.tsx#L334-L341)、[ui.tsx:607-614](../../../components/ui.tsx#L607-L614)）。
- `Toolbar`：エディタ上部の操作バー（[Toolbar.tsx:62-69](../../../components/Toolbar.tsx#L62-L69)）。 <!-- b_qjfvv5b8 -->

## 依存関係 <!-- b_n7pbakj9 -->

`components/Inspector.tsx` などを持つ components 側（`ButtonInspector`、`CardStage`）と、`lib/tokens.ts` や `lib/share.ts` などを持つ lib 側（`aiErrorText`、`AiWriteBtn`）に依存する（推測）。 逆方向では、components 側と `Editor` を含む app 側、lib 側から参照される（推測）。 <!-- b_zrnwwk7p -->

## 設定 <!-- b_rgsbkty4 -->

- `NEXT_PUBLIC_BASE_PATH`：`app/layout.tsx` と `components/ShareMenu.tsx` が読む（[layout.tsx:4](../../../app/layout.tsx#L4)）。
- `NEXT_PUBLIC_SITE_ORIGIN`：`app/layout.tsx` が読む（[layout.tsx:7](../../../app/layout.tsx#L7)）。 <!-- b_44qwvr29 -->

## テスト <!-- b_1a3qg8rb -->

`lib/i18n.parity.test.ts` は、`KO` が `UI` と同じキーを持つこと、各キーに非韓国語の全言語があること、テンプレートのプレースホルダーが言語間で揃うことを確かめる（[i18n.parity.test.ts:39](../../../lib/i18n.parity.test.ts#L39)、[i18n.parity.test.ts:44](../../../lib/i18n.parity.test.ts#L44)、[i18n.parity.test.ts:57](../../../lib/i18n.parity.test.ts#L57)）。 `lib/i18n.test.ts` は `isLang` が対応言語だけを受け入れることを確かめる（[i18n.test.ts:6](../../../lib/i18n.test.ts#L6)、[i18n.test.ts:10](../../../lib/i18n.test.ts#L10)）。 <!-- b_ae3ejmfh -->

## 落とし穴 <!-- b_ba6zh0j0 -->

> [!WARNING]
> **落とし穴**
> - `UI` に韓国語は含まれず、別の `KO` にある。`t` は ko のとき `KO` を引くので、キー追加は両方に要る（[i18n.ts:487-490](../../../lib/i18n.ts#L487-L490)、[i18n.ts:574](../../../lib/i18n.ts#L574)）。
> - `Editor` は `ssr: false` で動的に読み込まれるため、サーバー描画には含まれない（[page.tsx:8-13](../../../app/page.tsx#L8-L13)）。 <!-- b_nmf12cjv -->

> [!TIP]
> **まとめ**
> 共通 UI 部品、4 言語辞書、テーマ、アプリの入口を担うモジュールである。言語辞書の整合はテストで守られている。 <!-- b_3q1h9mnt -->
