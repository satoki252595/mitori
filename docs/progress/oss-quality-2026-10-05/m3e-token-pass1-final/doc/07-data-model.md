# 7. データモデル <!-- b_c3db2ntd -->

**主要な型（コードの宣言から読み取った 0 tok の一覧）**
| 型 | 種類 | 定義 | フィールド | 持っている型 | 使うファイル |
|---|---|---|---|---|---|
| `Palette` | type | `lib/tokens.ts:216` | 28 | — | 26 |
| `Item` | type | `lib/tokens.ts:1626` | 39 | `kind` → `Kind`・`variant` → `Variant`・`fill` → `ColorToken`・`action` → `Action` | 15 |
| `Frame` | type | `lib/tokens.ts:2117` | 11 | `bg` → `ColorToken`・`place` → `Place` | 13 |
| `Group` | type | `lib/tokens.ts:2317` | 8 | `items` → `Item` | 9 |
| `Variant` | type | `lib/tokens.ts:550` | — | — | 3 |
| `Doc` | type | `lib/tokens.ts:2340` | 12 | `groups` → `Group`・`frames` → `Frame`・`customPalette` → `Palette`・`theme` → `Theme` | 8 |
| `Theme` | type | `lib/tokens.ts:441` | 7 | `contrast` → `Contrast` | 6 |
| `Kind` | type | `lib/tokens.ts:581` | — | — | 8 |
| `Action` | type | `lib/tokens.ts:1752` | 3 | — | 7 |
| `ColorToken` | type | `lib/tokens.ts:1968` | — | — | 3 |
| `Contrast` | type | `lib/color.ts:85` | — | — | 2 |
| `Place` | type | `lib/tokens.ts:2137` | — | — | 5 |
<!-- b_ra69ew3f -->

```mermaid
flowchart LR
  t0_palette["Palette"]
  t1_item["Item"]
  t2_frame["Frame"]
  t3_group["Group"]
  t4_variant["Variant"]
  t5_doc["Doc"]
  t6_theme["Theme"]
  t7_kind["Kind"]
  t8_action["Action"]
  t9_colortoken["ColorToken"]
  t10_contrast["Contrast"]
  t11_place["Place"]
  t1_item -->|kind| t7_kind
  t1_item -->|variant| t4_variant
  t1_item -->|fill| t9_colortoken
  t1_item -->|action| t8_action
  t2_frame -->|bg| t9_colortoken
  t2_frame -->|place| t11_place
  t3_group -->|items| t1_item
  t5_doc -->|groups| t3_group
  t5_doc -->|frames| t2_frame
  t5_doc -->|customPalette| t0_palette
  t5_doc -->|theme| t6_theme
  t6_theme -->|contrast| t10_contrast
```
<!-- b_4cbeyvp8 -->

- スキーマ（テーブル・モデル）は検出されませんでした。
<!-- b_qp3fj03w -->
