# 9. 非機能 <!-- b_h6sysk7d -->

## ホットパス <!-- b_fys8pe9h -->

アニメーション更新は `LoadingAnimator.update` に集まる。経過時間 `dt` は 0.1 秒で頭打ちにされ、タブが止まった後でもスプリングが一度に大きく進まない（[shapes.ts:218-240](../../lib/shapes.ts#L218-L240)）。 <!-- b_k8ckthh1 -->

## キャッシュ <!-- b_13myvcbh -->

`getShapes` は変換結果をモジュール内の `cache` に保持し、2 回目以降は同じ配列を返す（[shapes.ts:154-162](../../lib/shapes.ts#L154-L162)）。`morphedShape` はこの配列を毎フレーム参照するだけなので、SVG パスの再サンプリングは初回だけで済む（[shapes.ts:164-177](../../lib/shapes.ts#L164-L177)）。 <!-- b_c7k35107 -->

## セキュリティ境界 <!-- b_vkzjf86k -->

- 共有リンクに載せる前に `shareable` が `noteHistory` を除き、`src` は http(s) の URL だけを残す（[share.ts:12-21](../../lib/share.ts#L12-L21)）。
- 外部から来る JSON は `isProject` で検証し、通らなければ `null` にする。`readProject` と `readShareHash` の両方がこの経路を通る（[project.ts:91-98](../../lib/project.ts#L91-L98)、[share.ts:56-73](../../lib/share.ts#L56-L73)）。
- `linkUrlOf` は http と https 以外のアドレスを受け付けない（[tokens.ts:1711-1719](../../lib/tokens.ts#L1711-L1719)）。 <!-- b_hqvka96a -->

## 信頼性 <!-- b_1tdw9b88 -->

- `readProject` と `readShareHash` は、解析や展開に失敗しても例外を投げず `null` を返す（[project.ts:91-98](../../lib/project.ts#L91-L98)、[share.ts:56-73](../../lib/share.ts#L56-L73)）。
- `normalizeTheme` は不正なテーマ値を `DEFAULT_THEME` の値へ戻す（[tokens.ts:456-467](../../lib/tokens.ts#L456-L467)）。
- `shareLink` は `CompressionStream` が無い環境では圧縮せず `DOC_PARAM` 形式にフォールバックする（[share.ts:46-53](../../lib/share.ts#L46-L53)）。 <!-- b_qxgdc35h -->
