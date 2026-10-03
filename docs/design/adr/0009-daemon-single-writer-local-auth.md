# ADR-0009: daemon — ユーザー単位・ワークスペースごとの単一 writer・ローカル認証

- 状態: 採用（2026-10-03） / 関連: synthesis §3.2（サーバ行）、01 §1.2–1.7、06 §6.4

## Context
CLI・ブラウザ・MCP shim・hook が同じ状態を読み書きする。crit は「メモリ上の状態」と「ディスクの JSON」の二重の真実源 + 1 秒 polling で件数がずれる race を持っていた。並列度・5h 枠の譲り合いは全 repo で一元管理する必要がある。ローカルでも DNS rebinding・CSRF・他ユーザーからのアクセスは防ぎたい。

## Decision
- **daemon はユーザーに 1 つ**（`~/.mitori/daemon.lock`）。複数ワークスペースを lazy load し、全 idle 30 分で終了（R1-2: 4 時間）。
- **ワークスペースごとの write queue**: 全変更は `write(label, fn)` を通る。中では SQLite transaction と `.mitori/` 書き出しの予約だけを行い、LLM・ネットワーク・重い git は待たない。commit 後に SSE を発行し `rev` を進める。CLI は書き込みを API で依頼する（直接書き込み禁止）。
- **認証**: `127.0.0.1` bind、Host 検査（421）、`/api/*` は `/health` 以外すべて認証。ブラウザは nonce 交換の HttpOnly/SameSite=Strict cookie（R1-1: 廃止し header の session token へ）、CLI/MCP/hook は registry（0600）の bearer token（起動ごとに再生成）。状態変更は `Sec-Fetch-Site: same-origin` か bearer 必須、JSON は `content-type: application/json` 必須、CORS は一切許可しない。ルートごとに呼べるクライアント種別を `ROUTE_META.clients` で制限。
- SSE は 1 本（`GET /events`）、`id = rev`、リングバッファ 1,000 件で replay、足りなければ `resync`（R1-6: `id = seq`、全体リング 4,096 件）。

## Consequences
- 書き込みの直列化でスループットは落ちるが、ローカル 1 ユーザーでは律速にならない（Bun.serve JSON 26k req/s、SQLite insert 10 万行 205 ms）。
- daemon が落ちると全 repo の UI が止まる → 起動は CLI が自動で行い、状態はすべて永続化されているので再起動で復元できる。
- 版の異なる CLI と daemon の扱い（idle なら再起動）が必要。

## Alternatives
- repo ごとの daemon（crit 方式）: 並列度の一元管理と Launcher ができない。
- CLI がファイルを直接書く: race の再発。
- WebSocket: SSE で足りる（p99 4.6 ms）。双方向が要る共同編集（DO）のときだけ。

## 改訂 R1（2026-10-03、レビュー反映） — 本節が上の Decision より優先

1. **ブラウザ認証を cookie から header へ（SEC-06）**: cookie は 127.0.0.1 の全 port（信頼できない repo の dev server、container の forward port）に送られるため、session cookie を廃止する。CLI は `http://127.0.0.1:<port>/auth#n=<nonce>&to=<path>` を開き、SPA が fragment の nonce を `POST /auth/exchange` で session token に交換して `localStorage`（origin に port を含む）に保存、以後 `authorization: Mitori-Session <token>`。SSE は `fetch()` stream。残る cookie は非秘密の `mitori_ui` だけ。
2. **session は daemon 再起動を越える（UXP-07）**: `~/.mitori/session.key`（0600）を鍵に、token の HMAC を `state.sqlite` の `srv_sessions` に保存（30 日 sliding、revoke 可、`mitori doctor --rotate-session`）。CLI の bearer は起動ごとの回転のまま。全 idle での自動終了は 30 分 → **4 時間**。port は前回値を強く優先（origin を保つ）。
3. **CLI は相手を確かめてから token を送る**: `GET /health?challenge=<random>` の `proof = HMAC(token, challenge)` を検証。
4. **実行系設定は web から変えられない**: `EXEC_SETTING_KEYS`（engines、limits の増加、pins、security、privacy の一部、autoCommit、autoAcceptDocUpdates）は `PATCH /settings` で `E_FORBIDDEN_KEY`。`mitori config set`（TTY 確認、CLAUDECODE/CODEX_* では拒否）か、人が config.json を直接編集する。
5. **`clients` は境界ではない（SEC-19）**: `ROUTE_META.clients` と `x-mitori-client` は誤用防止。同じユーザーのプロセスは registry を読めるので、どのセキュリティ主張もこれに依存しない。trust の決定は作成 60 s 未満の session から受け付けない。承認コード方式は P2 で判断。
6. **SSE（CONS-04）**: `id` は daemon 全体で単調な `seq`（上の「`id = rev`」を置換）。envelope `{seq, ws, rev, at}`、全体リング 4,096 件、`?last=<seq>`、`hello.boot` が違えば resync。coalesce は entity 単位（PT-01）。
7. **writer は 2 種類（CONS-03）**: workspace ごとの `write` と、`state.sqlite` 用の daemon 全体 1 つの `stateWrite`。
