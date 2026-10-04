# 7. データモデル <!-- b_nwjchzxe -->

**主要な型（コードの宣言から読み取った 0 tok の一覧）**
| 型 | 種類 | 定義 | フィールド | 持っている型 | 使うファイル |
|---|---|---|---|---|---|
| `Comment` | struct | `internal/session/session.go:129` | 31 | — | 17 |
| `CritJSON` | struct | `internal/session/session.go:540` | 21 | `ReviewComments` → `Comment`・`Files` → `CritJSONFile`・`Story` → `Story` | 31 |
| `Focus` | struct | `internal/session/session_focus.go:45` | 19 | — | 12 |
| `Config` | struct | `internal/config/config.go:22` | 40 | — | 17 |
| `Session` | struct | `internal/session/session.go:416` | 54 | `VCS` → `VCS`・`Files` → `FileEntry`・`reviewComments` → `Comment`・`story` → `Story`・`Focus` → `Focus` | 17 |
| `VCS` | interface | `internal/vcs/vcs.go:14` | — | — | 17 |
| `ChangeID` | struct | `internal/forge/forge.go:21` | 3 | — | 13 |
| `CritJSONFile` | struct | `internal/session/session.go:671` | 3 | `Comments` → `Comment` | 16 |
| `FileEntry` | struct | `internal/session/session.go:210` | 18 | `Comments` → `Comment` | 11 |
| `Server` | struct | `internal/server/server.go:58` | 39 | — | 10 |
| `Story` | struct | `internal/session/session.go:611` | 10 | — | 6 |
| `SessionEntry` | struct | `internal/daemon/daemon.go:94` | 9 | — | 14 |
<!-- b_sc749cx5 -->

```mermaid
flowchart LR
  t0_comment["Comment"]
  t1_critjson["CritJSON"]
  t2_focus["Focus"]
  t3_session["Session"]
  t4_vcs["VCS"]
  t5_critjsonfile["CritJSONFile"]
  t6_fileentry["FileEntry"]
  t7_story["Story"]
  t1_critjson -->|ReviewComments| t0_comment
  t1_critjson -->|Files| t5_critjsonfile
  t1_critjson -->|Story| t7_story
  t3_session -->|VCS| t4_vcs
  t3_session -->|Files| t6_fileentry
  t3_session -->|reviewComments| t0_comment
  t3_session -->|story| t7_story
  t3_session -->|Focus| t2_focus
  t5_critjsonfile -->|Comments| t0_comment
  t6_fileentry -->|Comments| t0_comment
```
<!-- b_3rshbakt -->

- スキーマ（テーブル・モデル）は検出されませんでした。
<!-- b_4627wsnr -->
