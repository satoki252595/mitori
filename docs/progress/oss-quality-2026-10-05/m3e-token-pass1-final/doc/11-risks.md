# 11. リスクと負債 <!-- b_6kkzz4ej -->

## テストの穴 <!-- b_fxw6hg6v -->

- components 配下の部品編集パネル群にテストが見当たらない（推測）。
- 対象は components/ui.tsx や components/Inspector.tsx、components/PartPanel.tsx などである（推測）。 <!-- b_jb062sxh -->

## ホットスポット <!-- b_n91xczq5 -->

> [!WARNING]
> **落とし穴**
> - 新種別の追加時には `KIND_SPEC` や `KIND_ORDER`、`sizeOf` を同時に更新する必要がある（[CONTRIBUTING.md:43-46](../../CONTRIBUTING.md#L43-L46)）。
> - lib/prompt.ts のプロンプト文追加では言語別文と `STYLE_NOTES` を同時に足す必要がある（[CONTRIBUTING.md:47-48](../../CONTRIBUTING.md#L47-L48)）。
> - components/M3Node.tsx の描画変更では `MEASURED` と `NO_BOX` の該当判定を更新する必要がある（[CONTRIBUTING.md:47](../../CONTRIBUTING.md#L47)、[M3Node.tsx:229](../../components/M3Node.tsx#L229)）。
> - app/Editor.tsx では `setGroups` が全更新に `constrainModalRails` を強制する（[Editor.tsx:461-464](../../app/Editor.tsx#L461-L464)）。
> - タップ可能な部品では components/Preview.tsx の対象も更新する必要がある（[CONTRIBUTING.md:47-49](../../CONTRIBUTING.md#L47-L49)）。
> - lib/i18n.ts では新種別の表示文として `KIND_TEXT` を 4 言語分足す必要がある（[CONTRIBUTING.md:45-46](../../CONTRIBUTING.md#L45-L46)）。 <!-- b_756vj0ak -->

## 壊れやすい箇所 <!-- b_0720vkyn -->

> [!WARNING]
> **落とし穴**
> - 色入力の検証は `hexToRgb` と `normalizeTheme`、`isHex` に分散し、形式外の値は null や既定値に置き換わる（[color.ts:16](../../lib/color.ts#L16)、[tokens.ts:456-458](../../lib/tokens.ts#L456-L458)、[color.ts:185](../../lib/color.ts#L185)）。
> - `complete` の失敗は例外として送出され、`aiErrorText` が言語別に文言を付けて示す（[ai.ts:79](../../lib/ai.ts#L79)、[ai.test.ts:42](../../lib/ai.test.ts#L42)、[AiPanel.tsx:10](../../components/AiPanel.tsx#L10)）。
> - 検証連鎖は `KINDS` や `LAYOUTS` から `validItem`、`isProject` へ連なり、新種別の追加が読み込み可否に影響する（[project.ts:9](../../lib/project.ts#L9)、[project.ts:17](../../lib/project.ts#L17)、[project.ts:20](../../lib/project.ts#L20)、[project.ts:66-67](../../lib/project.ts#L66-L67)）。
> - 不正な URL 入力は `linkUrlOf` が null で返すため、リンク指定が静かに失われる（[tokens.ts:1711-1720](../../lib/tokens.ts#L1711-L1720)）。
> - 手編集の `promptEdit` があるとプロンプト文が置き換わり、元の生成結果は残らない（[prompt.ts:1864](../../lib/prompt.ts#L1864)）。 <!-- b_c33x5935 -->

- （検出されませんでした）
<!-- b_fb8zhwga -->

- （検出されませんでした）
<!-- b_t9gvg95b -->
