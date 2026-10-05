# 10. 設計判断 <!-- b_b0svs594 -->

> [!IMPORTANT]
> **サーバを持たず単一ページを静的出力し、保存はブラウザに置く**（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。
> `npm run build` は `out/` への静的出力であり、成果物はそのまま配布できる（[CONTRIBUTING.md:22](../../CONTRIBUTING.md#L22)）。
> 永続化や共有を変える場合はサーバ側の記憶を前提にできず、ブラウザ保存と静的配信に収める作り直しが要る（推測）。 <!-- b_fv6dbq2g -->

> [!IMPORTANT]
> **AI 支援は利用者の鍵をブラウザに置き、直接業者へ要求する**（[README.md:50](../../README.md#L50)）。
> 対応先は `OpenAI`、`Claude`、`Gemini`、`DeepSeek` であり、鍵を預かる中継サーバは置かない（[README.md:50](../../README.md#L50)）。
> 鍵や履歴の扱いを変える場合はブラウザ外へ持ち出さない前提を見直す必要がある（推測）。 <!-- b_pcsg2cmr -->

> [!IMPORTANT]
> **部品描画はパレットトークンのみから行い、編集画面の装飾と分離する**（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。
> ダークモードと全配色で正しく保つ狙いである（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。
> 部品側に固定色や装飾依存を持ち込む変更は、この分離を崩すため取り止めか設計の見直しが要る（推測）。 <!-- b_vrwq208w -->

> [!IMPORTANT]
> **UI 文言とプロンプト文は 4 言語すべてにそろえて追加する**（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。
> 対象は日本語と英語と中国語と韓国語であり、コードの注釈は英語で書く（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。
> 文言を足す変更は 4 言語分の対訳をそろえる必要があり、1 言語だけの追加は方針に反する（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。 <!-- b_fgd2xddw -->

> [!IMPORTANT]
> **寸法や角丸やトークンは Material 3 Expressive の標準値を用い、Material の名称で呼ぶ**（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。
> 迷う場合は PR で Material の頁へ参照する（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。
> 独自の数値や命名を持ち込む変更は、この語彙合わせを崩すため採用の見直しが要る（推測）。 <!-- b_j8794cbe -->

> [!IMPORTANT]
> **新しい部品種別は定められた複数箇所を同時に触って追加する**（[CONTRIBUTING.md:43-44](../../CONTRIBUTING.md#L43-L44)）。
> `Kind` と `KIND_SPEC` と `KIND_ORDER` の定義から描画や文言や編集器まで既存種別を参照してそろえる（[CONTRIBUTING.md:45-49](../../CONTRIBUTING.md#L45-L49)）。
> 1 箇所だけを足す変更は描画や指示文や編集の不整合を残すため、全体の追従が必要になる（推測）。 <!-- b_ytddw4g5 -->

> [!IMPORTANT]
> **プロンプト文言を含む大きめの変更は実装前に Issue で合意する**（[CONTRIBUTING.md:9-12](../../CONTRIBUTING.md#L9-L12)）。
> Material 3 Expressive の語彙に合わせ、注意深く調整されたプロンプトの手戻りを避けるためである（[CONTRIBUTING.md:9-12](../../CONTRIBUTING.md#L9-L12)）。
> 部品やパネルや文言の追加は小さな修正として直接送らず、先の相談が必要になる（[CONTRIBUTING.md:8-10](../../CONTRIBUTING.md#L8-L10)）。 <!-- b_11ex40ep -->

> [!IMPORTANT]
> **検証は型検査と単体試験と構築の 3 点を通し、Node 22 系で実行する**（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。
> `npm run typecheck` と `npm test` と `npm run build` を通り、CI も同じ 3 点を実行する（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。
> 試験群が `Node 22.12` 以上を要求し、CI が `Node 22` を用いるためである（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。 <!-- b_q1q9n1nt -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_fhy5ch0f -->
