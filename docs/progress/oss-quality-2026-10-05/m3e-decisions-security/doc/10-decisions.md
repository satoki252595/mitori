# 10. 設計判断 <!-- b_b0svs594 -->

> [!IMPORTANT]
> **サーバを持たず単一ページを静的出力し、保存はブラウザに置く**（[CONTRIBUTING.md:22](../../CONTRIBUTING.md#L22)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。単一 Next.js ページでサーバを持たず、保存先をブラウザとし、`npm run build` で `out/` に静的出力する構成である（[CONTRIBUTING.md:22](../../CONTRIBUTING.md#L22)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。サーバや外部保存を導入する変更では、ビルドと配布と保存の前提を見直す必要がある（推測）。 <!-- b_fv6dbq2g -->

> [!IMPORTANT]
> **AI 支援の鍵はブラウザに置き、プロバイダーへ直接リクエストする**（[README.md:50](../../README.md#L50)）。対象は OpenAI と Claude と Gemini と DeepSeek であり、中継サーバを置かず鍵はブラウザに残る（[README.md:50](../../README.md#L50)）。鍵の送信先や保存先を変える場合は、鍵がブラウザから各プロバイダーへ直接送られる前提を見直す必要がある（推測）。 <!-- b_pcsg2cmr -->

> [!IMPORTANT]
> **部品描画はパレットトークンのみから行い、エディターの装飾と分離する**（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。ダークモードと全配色で正しく保つためである（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。部品側に装飾依存を持ち込む変更では、配色切替え時の表示前提を見直す必要がある（推測）。 <!-- b_vrwq208w -->

> [!IMPORTANT]
> **UI 文言とプロンプト文は 4 言語すべてにそろえて追加する**（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。対象は日本語と英語と中国語と韓国語であり、コードの注釈は英語で書く（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。4 言語で同等に使える状態を保つためである（推測）。1 言語だけの追加は方針に反し、文言変更では 4 言語分の対訳をそろえる必要がある（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。 <!-- b_fgd2xddw -->

> [!IMPORTANT]
> **寸法や角丸やトークンは Material 3 Expressive の標準値を用い、Material の名称で呼ぶ**（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。標準値に従い Material の呼び方にそろえることで、部品間の寸法と語彙の一貫性を保つ（推測）。迷う場合は PR で Material の頁へ参照する（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。独自の寸法や名称を持ち込む変更では、標準値との対応を見直す必要がある（推測）。 <!-- b_j8794cbe -->

> [!IMPORTANT]
> **新しい部品種別は定められた複数箇所を同時に触って追加する**（[CONTRIBUTING.md:43-44](../../CONTRIBUTING.md#L43-L44)）。`Kind` と `KIND_SPEC` と `KIND_ORDER` の定義から描画や文言や編集器まで既存種別を参照してそろえる（[CONTRIBUTING.md:43-45](../../CONTRIBUTING.md#L43-L45)）。一部だけ足す変更では、描画や文言や編集の抜けを見直す必要がある（推測）。 <!-- b_ytddw4g5 -->

> [!IMPORTANT]
> **プロンプト文言を含む大きめの変更は実装前に issue で合意する**（[CONTRIBUTING.md:9-10](../../CONTRIBUTING.md#L9-L10)）。Material 3 Expressive の語彙に合わせ、注意深く調整されたプロンプトの手戻りを避けるためである（[CONTRIBUTING.md:11-12](../../CONTRIBUTING.md#L11-L12)）。合意なく進める場合は、事前相談の要否を見直す必要がある（推測）。 <!-- b_11ex40ep -->

> [!IMPORTANT]
> **検証は型検査と単体テストとビルドの 3 点を通し、Node 22 系で実行する**（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。`npm run typecheck` と `npm test` と `npm run build` を通り、CI も同じ 3 点を実行する（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。試験群が Node 22.12 以上を要求し、CI が Node 22 を用いるためである（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。検証を省く変更では、CI との一致を見直す必要がある（推測）。 <!-- b_q1q9n1nt -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_fhy5ch0f -->
