# ADR-0009: daemon — ユーザー単位・ワークスペースごとの単一 writer・ローカル認証

- 状態: 採用（2026-10-03） / 関連: synthesis §3.2（サーバ行）、01 §1.2–1.7、06 §6.4

## Context
CLI・ブラウザ・MCP shim・hook が同じ状態を読み書きする。crit は「メモリ上の状態」と「ディスクの JSON」の二重の真実源 + 1 秒 polling で件数がずれる race を持っていた。並列度・5h 枠の譲り合いは全 repo で一元管理する必要がある。ローカルでも DNS rebinding・CSRF・他ユーザーからのアクセスは防ぎたい。

## Decision
- **daemon はユーザーに 1 つ**（`~/.mitori/daemon.lock`）。複数ワークスペースを lazy load し、全 idle 30 分で終了。
- **ワークスペースごとの write queue**: 全変更は `write(label, fn)` を通る。中では SQLite transaction と `.mitori/` 書き出しの予約だけを行い、LLM・ネットワーク・重い git は待たない。commit 後に SSE を発行し `rev` を進める。CLI は書き込みを API で依頼する（直接書き込み禁止）。
- **認証**: `127.0.0.1` bind、Host 検査（421）、`/api/*` は `/health` 以外すべて認証。ブラウザは nonce 交換の HttpOnly/SameSite=Strict cookie、CLI/MCP/hook は registry（0600）の bearer token（起動ごとに再生成）。状態変更は `Sec-Fetch-Site: same-origin` か bearer 必須、JSON は `content-type: application/json` 必須、CORS は一切許可しない。ルートごとに呼べるクライアント種別を `ROUTE_META.clients` で制限。
- SSE は 1 本（`GET /events`）、`id = rev`、リングバッファ 1,000 件で replay、足りなければ `resync`。

## Consequences
- 書き込みの直列化でスループットは落ちるが、ローカル 1 ユーザーでは律速にならない（Bun.serve JSON 26k req/s、SQLite insert 10 万行 205 ms）。
- daemon が落ちると全 repo の UI が止まる → 起動は CLI が自動で行い、状態はすべて永続化されているので再起動で復元できる。
- 版の異なる CLI と daemon の扱い（idle なら再起動）が必要。

## Alternatives
- repo ごとの daemon（crit 方式）: 並列度の一元管理と Launcher ができない。
- CLI がファイルを直接書く: race の再発。
- WebSocket: SSE で足りる（p99 4.6 ms）。双方向が要る共同編集（DO）のときだけ。
