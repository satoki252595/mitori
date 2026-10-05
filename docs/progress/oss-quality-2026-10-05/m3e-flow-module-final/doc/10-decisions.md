# 10. 設計判断 <!-- b_b0svs594 -->

> [!IMPORTANT]
> **サーバを持たず単一ページを静的出力し、保存はブラウザに置く**（[CONTRIBUTING.md:22](../../CONTRIBUTING.md#L22)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。配布と実行を静的資産のみで完結させるための構成だ（推測）。保存先や配信形態を変える場合は、`npm run build` が `out/` へ出力する前提とブラウザ保存の前提を見直す必要がある（[CONTRIBUTING.md:22](../../CONTRIBUTING.md#L22)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。 <!-- b_fv6dbq2g -->

> [!IMPORTANT]
> **AI 支援の鍵はブラウザに置き、プロバイダーへ直接リクエストする**（[README.md:50](../../README.md#L50)）。対象は OpenAI と Claude と Gemini と DeepSeek だ（[README.md:50](../../README.md#L50)）。中継サーバを持たずに構成を単純に保つためだ（推測）。鍵の保存先はブラウザであり、送信先は選択したプロバイダーになるため、中継の追加や送信先の変更では鍵の扱いを見直す必要がある（[README.md:50](../../README.md#L50)）。 <!-- b_pcsg2cmr -->

> [!IMPORTANT]
> **部品描画はパレットトークンのみから行い、エディターの装飾と分離する**（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。ダークモードと全配色で正しく保つためだ（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。描画に固有色を持ち込む変更では、ダークモードと配色切替での見え方を見直す必要がある（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。 <!-- b_vrwq208w -->

> [!IMPORTANT]
> **UI 文言とプロンプト文は 4 言語すべてにそろえて追加する**（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。対象は日本語と英語と中国語と韓国語であり、コードの注釈は英語で書く（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。4 言語の利用者を同等に扱うためだ（推測）。1 言語だけの追加は方針に反し、文言変更では 4 言語分の対訳をそろえる必要がある（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。 <!-- b_fgd2xddw -->

> [!IMPORTANT]
> **寸法や角丸やトークンは Material 3 Expressive の標準値を用い、Material の名称で呼ぶ**（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。迷う場合は PR で Material の頁へ参照する（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。Material の語彙に合わせるためだ（推測）。独自の寸法や名称を持ち込む変更では、標準値との差異と命名の対応を見直す必要がある（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。 <!-- b_j8794cbe -->

> [!IMPORTANT]
> **新しい部品種別は定められた複数箇所を同時に触って追加する**（[CONTRIBUTING.md:43-44](../../CONTRIBUTING.md#L43-L44)）。`Kind` と `KIND_SPEC` と `KIND_ORDER` の定義から描画や文言や編集器まで既存種別を参照してそろえる（[CONTRIBUTING.md:43-49](../../CONTRIBUTING.md#L43-L49)）。描画と文言と編集を欠けなくそろえるためだ（推測）。1 箇所だけの追加では未対応の面が残るため、追加時は一覧の全項目を見直す必要がある（[CONTRIBUTING.md:43](../../CONTRIBUTING.md#L43)）。 <!-- b_ytddw4g5 -->

> [!IMPORTANT]
> **プロンプト文言を含む大きめの変更は実装前に issue で合意する**（[CONTRIBUTING.md:9-10](../../CONTRIBUTING.md#L9-L10)）。Material 3 Expressive の語彙に合わせ、注意深く調整されたプロンプトの手戻りを避けるためだ（[CONTRIBUTING.md:11-12](../../CONTRIBUTING.md#L11-L12)）。対象外の小さな修正は直接 issue や PR で扱い、大きめの変更では事前相談を省かない必要がある（[CONTRIBUTING.md:8-10](../../CONTRIBUTING.md#L8-L10)）。 <!-- b_11ex40ep -->

> [!IMPORTANT]
> **検証は型検査と単体テストとビルドの 3 点を通す**（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。`npm run typecheck` と `npm test` と `npm run build` を通り、CI も同じ 3 点を実行する（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。試験群が Node 22.12 以上を要求し、CI が Node 22 を用いるためだ（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。検証を省く変更では、型と試験と静的出力を別々に確認し直す必要がある（推測）。 <!-- b_q1q9n1nt -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_fhy5ch0f -->
