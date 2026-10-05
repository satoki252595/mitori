# 10. 設計判断 <!-- b_r7ptwt4c -->

> [!IMPORTANT]
> **サーバーを持たない静的サイトとして配布し、編集内容をブラウザに保存する**（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)、[README.md:20](../../README.md#L20)）。
> 配布と運用を単純に保つための判断である（推測）。
> 共有リンクや保存はサーバーなしを前提にするため、永続化を変える際は確認が必要である（[README.md:52-53](../../README.md#L52-L53)、[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。 <!-- b_4mv6cqdq -->

> [!IMPORTANT]
> **AI 支援のキーは利用者が持ち込み、ブラウザからプロバイダーへ直接リクエストする**（[README.md:50](../../README.md#L50)）。
> キーをサーバーに預けず、ブラウザに置くためである（[README.md:50](../../README.md#L50)）。
> キーはブラウザに保存されるが、認証付きリクエストはプロバイダーに届くため、送信先の追加や変更時は確認が必要である（[README.md:50](../../README.md#L50)）。 <!-- b_22f56q8e -->

> [!IMPORTANT]
> **デザイン全体または単一画面を、対象と言語別の簡潔な自然言語プロンプトとして出力する**（[README.md:48](../../README.md#L48)）。
> どの AI コーディングツールにも渡せる受け渡し形式にするためである（[README.md:35](../../README.md#L35)）。
> プロンプト文言の変更は 4 言語と調整済みの言い回しに影響するため、事前相談が必要になる（[CONTRIBUTING.md:9-12](../../CONTRIBUTING.md#L9-L12)、[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。 <!-- b_hkxf2rk8 -->

> [!IMPORTANT]
> **UI 文言とプロンプト文は日本語、英語、中国語、韓国語の 4 言語で揃える**（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。
> 言語を切り替えても編集と出力を同じに保つためである（推測）。
> 1 言語だけの追加は受け入れられず、4 言語分の更新が必要になる（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。 <!-- b_cb8yapf4 -->

> [!IMPORTANT]
> **部品はパレットトークンのみで描き、エディター枠と描画経路を分ける**（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。
> ダークモードと全配色で正しく保つためである（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。
> 固定色を持ち込む場合は、ダークモードと配色での見え方を確認する必要がある（推測）。 <!-- b_e5yv9swb -->

> [!IMPORTANT]
> **寸法や角丸やトークンは Material 3 Expressive の標準値を用い、Material の名称で呼ぶ**（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。
> Material 3 Expressive は固有の語彙を持つためである（[CONTRIBUTING.md:11-12](../../CONTRIBUTING.md#L11-L12)）。
> 独自寸法や独自名の追加は、参照した Material のページと合わせて確認が必要になる（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。 <!-- b_pybad8j8 -->

> [!IMPORTANT]
> **Node 22.12 以上で開発し、型検査と単体試験とビルドを通す**（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)、[CONTRIBUTING.md:64-65](../../CONTRIBUTING.md#L64-L65)）。
> 試験群が Node 22.12 を必要とし、CI は Node 22 を使うためである（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。
> 道具や設定を変える場合も、同じ 3 手順の通過を確認する必要がある（[CONTRIBUTING.md:64-65](../../CONTRIBUTING.md#L64-L65)）。 <!-- b_ak26gjwg -->

> [!IMPORTANT]
> **実行時表示の開閉状態は保存対象から除き、永続化しない**（[tokens.ts:1693-1694](../../lib/tokens.ts#L1693-L1694)、[tokens.ts:1851](../../lib/tokens.ts#L1851)）。
> 保存形式を再生に必要な内容に絞るためである（推測）。
> 選択日のような使い捨て値を保存に含める変更は、読み戻しと共有への影響を確認する必要がある（[tokens.ts:674-676](../../lib/tokens.ts#L674-L676)）。 <!-- b_pf8v92r0 -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_qzcqnc16 -->
