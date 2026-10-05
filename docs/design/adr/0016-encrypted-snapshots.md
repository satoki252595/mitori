# ADR-0016: `mitori.snapshot/1` — 暗号化された期限付き共有

- 採用: 2026-10-05。ADR-0008 R1 の実装。公開は別途利用者の承認後。
- 閲覧用 HTML は既存の secret scan/CSP 付き export を再利用する。コード抜粋と決定の公開は明示的な opt-in。
- AES-256-GCM、ランダムな 96-bit nonce、AAD は `mitori.snapshot/1:<id>`。鍵はランダム 256-bit、URL fragment のみ。Worker/R2 に鍵・平文を送らない。改変と異なる id への置換を復号時に拒否する。
- install ごとの Ed25519 公開鍵を D1 に登録。snapshot の id・暗号文 SHA-256・期限・コメント用 capability hash・timestamp・export script CSP hash を署名。署名 timestamp は ±5 分、保存中のidは再利用不可。秘密鍵は利用者の mitori home に SafeWriter で保存。
- 1 snapshot 5,000,000 byte、1 install 20 件/50,000,000 byte、全 install 合計 8,000,000,000 byte。D1 の同一 write transaction 内の trigger で予約し、R2 put 失敗時は予約を取り消す。競合する upload でも quota を越えない。
- 全体100,000 snapshot/100,000 comment、暗号文comment合計200 MB。D1のbase64・metadata・indexの余裕を残す。R2 putは月10,000件、getは月1,000,000件をD1で原子的に予約。失敗したR2操作も枠を消費する。月跨ぎをUTCでリセットする。
- TTL は最大30日、閲覧時の期限確認、scheduled cleanup と R2 lifecycle の二重削除。削除後のメタデータを長期保持しない。
- コメントは同じ AES 鍵、独立 nonce と `mitori.snapshot/1:<id>:comment` AAD で暗号化。fragment 内の別のランダム capability で書き込みを許可（Worker はその hash だけ保持）。最大100件、各暗号文16,384byte。本文は textContent で表示する。
- 復号した HTML は `sandbox="allow-scripts"` iframe に入れる。export 自身の CSP は外部通信禁止。srcdocが親CSPを継承するため、親にも署名済みexport script hashを追加する。iframeはopaque originで親DOMへのアクセスを拒否する。閲覧側の shell は same-origin の暗号文 API のみ通信する。CLI は viewer script SHA-256 を表示し、同じ script を埋め込んだローカル viewer HTML を出力できる。
- fragment はブラウザ履歴/同期に残る。リンクを持つ人は復号・コメントできる旨を CLI と viewer に表示する。
- 新規Paid化はしない。既存アカウントのプランを利用する。R2無料枠は他サービスと共通で、アプリの容量・操作上限はアカウント請求のhard capではない。公開前に R2 の有効化・既存使用量・30日 lifecycle・費用確認方法を確認する。Paid 化と月1,000円以上の継続費用増は事前承認。

出典（2026-10-05確認）: [R2料金](https://developers.cloudflare.com/r2/pricing/)、[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers制限](https://developers.cloudflare.com/workers/platform/limits/)、[Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)。
