# 10. 設計判断 <!-- b_b0svs594 -->

> [!IMPORTANT]
> **サーバを持たず単一ページを静的出力し、保存はブラウザに置く**（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)、[CONTRIBUTING.md:22](../../CONTRIBUTING.md#L22)）。サーバ側の永続化を採らないことで配布と実行の経路を単純に保つ狙いである（推測）。保存や共有の方式を変える場合は静的配布とブラウザ保存の前提を見直す必要がある（推測）。 <!-- b_fv6dbq2g -->

> [!IMPORTANT]
> **AI 支援の鍵はブラウザに置き、プロバイダーへ直接リクエストする**（[README.md:50](../../README.md#L50)）。対象は OpenAI と Claude と Gemini と DeepSeek であり、中継サーバは置かない（[README.md:50](../../README.md#L50)）。鍵の扱いや送信先を変える場合は鍵がブラウザ外に出ない前提を見直す必要がある（推測）。 <!-- b_pcsg2cmr -->

> [!IMPORTANT]
> **部品描画はパレットトークンのみから行い、エディターの装飾と分離する**（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。ダークモードと全配色で正しく保つためである（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。新しい描画を足す場合はパレット外の色を持ち込まず、既存の分離を崩さない必要がある（推測）。 <!-- b_vrwq208w -->

> [!IMPORTANT]
> **UI 文言とプロンプト文は 4 言語すべてにそろえて追加する**（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。対象は日本語と英語と中国語と韓国語であり、コードの注釈は英語で書く（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。4 言語の利用者が同じ内容を使える状態を保つ狙いである（推測）。1 言語だけの追加は方針に反し、文言変更では 4 言語分の対訳をそろえる必要がある（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。 <!-- b_fgd2xddw -->

> [!IMPORTANT]
> **寸法や角丸やトークンは Material 3 Expressive の標準値を用い、Material の名称で呼ぶ**（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。迷う場合は PR で Material の頁へ参照する（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。表記と寸法のぶれを抑え、共通の語彙に合わせる狙いである（推測）。独自値を足す場合は標準値との対応を明らかにし、命名のずれを持ち込まない必要がある（推測）。 <!-- b_j8794cbe -->

> [!IMPORTANT]
> **新しい部品種別は定められた複数箇所を同時に触って追加する**（[CONTRIBUTING.md:43-44](../../CONTRIBUTING.md#L43-L44)）。`Kind` と `KIND_SPEC` と `KIND_ORDER` の定義から描画や文言や編集器まで既存種別を参照してそろえる（[CONTRIBUTING.md:43-45](../../CONTRIBUTING.md#L43-L45)）。1 箇所だけの追加は全体の不整合を招くため、描画と文言と編集支援の対応を見直す必要がある（推測）。 <!-- b_ytddw4g5 -->

> [!IMPORTANT]
> **プロンプト文言を含む大きめの変更は実装前に issue で合意する**（[CONTRIBUTING.md:9-10](../../CONTRIBUTING.md#L9-L10)）。Material 3 Expressive の語彙に合わせ、注意深く調整されたプロンプトの手戻りを避けるためである（[CONTRIBUTING.md:11-12](../../CONTRIBUTING.md#L11-L12)）。対象の変更を直接送る場合は事前相談の要否を見直し、合意なく進めない必要がある（[CONTRIBUTING.md:9-10](../../CONTRIBUTING.md#L9-L10)）。 <!-- b_11ex40ep -->

> [!IMPORTANT]
> **検証は型検査と単体テストとビルドの 3 点を通し、Node 22 系で実行する**（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。`npm run typecheck` と `npm test` と `npm run build` を通り、CI も同じ 3 点を実行する（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。試験群が Node 22.12 以上を要求し、CI が Node 22 を用いるためである（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。検証を省く変更は受け入れられず、環境を変える場合は CI との一致を見直す必要がある（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。 <!-- b_q1q9n1nt -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_fhy5ch0f -->
