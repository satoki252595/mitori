# 9. 非機能 <!-- b_kmqy629b -->

## ホットパス <!-- b_krrhdge0 -->

リポジトリ走査とファイル内容取得では重い処理を使い回しや遅延で避ける作りが internal/vcs と internal/session にまたがり、`DefaultBranch` の検出結果再利用と `ensureFileLoaded` による必要時読み込みがその例である（[git.go:111-121](../../internal/vcs/git.go#L111-L121)、[session.go:231-232](../../internal/session/session.go#L231-L232)、[session.go:262-285](../../internal/session/session.go#L262-L285)）。
遠隔取得では内容やメタデータを束ねて反復取得を抑える作りが internal/session と internal/github にまたがり、`bytesLRU` への集約と `prMetadataCache` の `get` による取得前検査がその例である（[lru\_bytes.go:21-25](../../internal/session/lru_bytes.go#L21-L25)、[pr\_cache.go:58-66](../../internal/github/pr_cache.go#L58-L66)）。 <!-- b_jpfta3mg -->

## キャッシュ <!-- b_73tjqx6h -->

- デーモン側のセッション保管は鍵付きの一時保存として internal/daemon に寄り、`SessionKey` で求めた鍵で引いて `FindAliveSession` が不成立時に `RemoveSessionFile` で掃除する形がその例である（[daemon.go:178-194](../../internal/daemon/daemon.go#L178-L194)、[daemon.go:311-321](../../internal/daemon/daemon.go#L311-L321)）。
- 変更ホスト側のメタデータ取得は取得前検査と退避で抑える作りが internal/github に寄り、`prMetadataCache` の `get` が `prCacheKey` で引く `entries` を保持して上限超過で `evictOldestLocked` を呼ぶ形がその例である（[pr\_cache.go:58-87](../../internal/github/pr_cache.go#L58-L87)）。
- ブランチ検出やファイル内容や遠隔内容の使い回しが internal/vcs と internal/session にまたがり、`DefaultBranch` の再利用と `ensureFileLoaded` による遅延読みと `bytesLRU` への集約がその例である（[git.go:111-121](../../internal/vcs/git.go#L111-L121)、[session.go:231-232](../../internal/session/session.go#L231-L232)、[session.go:262-285](../../internal/session/session.go#L262-L285)、[lru\_bytes.go:21-25](../../internal/session/lru_bytes.go#L21-L25)）。 <!-- b_1rh2hfww -->

## 上限値 <!-- b_qek44q39 -->

- セッション鍵は固定長の 16 進表現に寄り、`SessionKey` が末尾 12 文字に切り詰めて `ValidSessionKey` が 12 文字の hex のみ通す形がその例である（[daemon.go:178-194](../../internal/daemon/daemon.go#L178-L194)、[daemon.go:209-220](../../internal/daemon/daemon.go#L209-L220)）。
- 深さや待ちの上限を呼び出し側や待機設定で区切る作りが internal/vcs と internal/daemon にまたがり、`WalkAncestors` の `maxDepth` と待機系の `timeout` と `stopWait` がその例である（[git.go:844](../../internal/vcs/git.go#L844)、[daemon.go:61-74](../../internal/daemon/daemon.go#L61-L74)）。
- 永続化ファイルの権限を所有者のみ読み書きに寄せる作りが internal/daemon と internal/config にまたがり、`WriteSessionFile` が 0600 で `AtomicWriteFile` し `SaveGlobalConfig` が 0o600 で `AtomicWriteFile` する形がその例である（[daemon.go:266-276](../../internal/daemon/daemon.go#L266-L276)、[config.go:601-611](../../internal/config/config.go#L601-L611)、[config.go:631-634](../../internal/config/config.go#L631-L634)）。 <!-- b_58s429h9 -->

## セキュリティ境界 <!-- b_6mp863yw -->

- 公開面の受付検査が internal/server に寄り、`ServeHTTP` がホスト検査と Fetch Site 検査を通した要求だけ振り分け表へ渡す形がその例である（[README.md:9-11](../../integrations/docker/README.md#L9-L11)、[server.go:278-293](../../internal/server/server.go#L278-L293)）。
- 鍵の正当性と保存の不可分性が internal/daemon に寄り、`ValidSessionKey` が 12 文字 hex のみ通して `WriteSessionFile` が `AtomicWriteFile` で 0600 保存する形がその例である（[daemon.go:209-220](../../internal/daemon/daemon.go#L209-L220)、[daemon.go:266-276](../../internal/daemon/daemon.go#L266-L276)）。
- 秘密情報の表示抑止と施錠保存が internal/config と internal/auth にまたがり、`Config` の `String` が `AuthToken` を伏せ字にし `SaveGlobalConfig` が施錠と原子書きし `CRIT_AUTH_TOKEN` で注入する形がその例である（[config.go:144-148](../../internal/config/config.go#L144-L148)、[config.go:601-611](../../internal/config/config.go#L601-L611)、[config.go:631-634](../../internal/config/config.go#L631-L634)、[auth.go:368](../../internal/auth/auth.go#L368)）。
- 異なる起点への転送と未承認公開の拒否が internal/config に寄り、`CrossOriginRedirectError` で転送を拒み `ErrUnauthenticatedNetwork` で未承認公開を止める形がその例である（[share\_targets.go:35-37](../../internal/config/share_targets.go#L35-L37)、[network.go:52](../../internal/config/network.go#L52)）。 <!-- b_vqx3cwn4 -->

## 信頼性 <!-- b_6acnyg08 -->

- 差分入力の揺れを正常系として吸収する作りが internal/vcs に寄り、`ParseUnifiedDiff` が最初のハンク見出しより前の行を捨てて終了符号 1 を差分ありとして扱う形がその例である（[git.go:1511-1515](../../internal/vcs/git.go#L1511-L1515)、[git.go:1547-1549](../../internal/vcs/git.go#L1547-L1549)、[git.go:360-366](../../internal/vcs/git.go#L360-L366)、[git.go:477-478](../../internal/vcs/git.go#L477-L478)）。
- 生存確認と経路解決の失敗時退避が internal/daemon に寄り、`FindAliveSession` が不成立時に `RemoveSessionFile` し `ResolvedCWD` が解決失敗で元経路に退き `DaemonHasBrowser` が到達不能で真を仮定する形がその例である（[daemon.go:311-321](../../internal/daemon/daemon.go#L311-L321)、[daemon.go:162-172](../../internal/daemon/daemon.go#L162-L172)、[daemon.go:553-562](../../internal/daemon/daemon.go#L553-L562)）。
- 対象欠落時の空応答が internal/session に寄り、`AddComment` が対象なしで偽を返して `GetComments` が対象なしで空列を返す形がその例である（[session.go:1282-1288](../../internal/session/session.go#L1282-L1288)、[session.go:1870-1876](../../internal/session/session.go#L1870-L1876)）。
- 保管庫や応答の欠損読み飛ばしが internal/review と web にまたがり、`findReviewFileByBranch` が壊れた JSON を警告付きで読み飛ばし `MatchingLiveSessions` が根なしで空を返し `fetchJSON` が JSON 以外で空値を返す形がその例である（[review\_file.go:498-512](../../internal/review/review_file.go#L498-L512)、[review\_file.go:204-216](../../internal/review/review_file.go#L204-L216)、[crit-shared.js:23-35](../../web/crit-shared.js#L23-L35)）。 <!-- b_vmdz5hsy -->

## 可観測性 <!-- b_26xm6578 -->

稼働確認の接点が internal/server と internal/daemon にまたがり、`DaemonHasBrowser` が到達不能や旧形式で真を仮定して `BrowserClients` の有無で判定する作りがその例である（[daemon.go:553-576](../../internal/daemon/daemon.go#L553-L576)）。
診断出力と切替えが cmd/crit と internal/session にまたがり、検査系の誤出力書き出しと `CRIT_DEBUG` による切替えがその例である（[integrations.go:708-718](../../cmd/crit/integrations.go#L708-L718)、[session.go:2510](../../internal/session/session.go#L2510)）。 <!-- b_zv4jbv3e -->
