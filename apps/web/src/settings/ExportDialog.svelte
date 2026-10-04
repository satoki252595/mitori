<!--
  「HTML として書き出す」 (ux.md §4.13, UXP-18; ⌘K and the settings page): one self-contained, read-only file of the
  document — no network, the same Reader / map / ⌘K. The options are the export's own (`ExportReq`): the reader
  level it opens at, the language, the resolved decisions, the code excerpts of the cite peeks. Every option change
  re-runs the export (`POST /ws/:ws/export`, 0 tokens, a second or less) so the dialog shows what the file WILL
  contain: its size, the excerpts (「コードの抜粋{n}箇所（{m}ファイル）」) and how many secret-like strings were
  masked. ダウンロード saves that very result (no second request). A modal <dialog>; closing returns focus.
-->
<script lang="ts">
import { type DocLang, type ExportRes, MitoriError, type ReaderLevel } from "@mitori/core";
import { untrack } from "svelte";
import { errorText, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { exportFileName, fmtBytes } from "./export.ts";

const s = useStores();
let dlg: HTMLDialogElement | undefined = $state();
let level = $state<ReaderLevel>(untrack(() => s.doc.level));
let lang = $state<DocLang>(untrack(() => s.doc.lang));
let decisions = $state(false);
let excerpts = $state(true);
let res = $state.raw<ExportRes | null>(null);
/** The options `res` was made with: the summary describes the file, not the checkboxes. */
let resExcerpts = $state(true);
let busy = $state(false);
let error = $state<string | null>(null);
let seq = 0;

$effect(() => {
  if (!dlg) return;
  s.layers.open("dialog", "export", () => {
    dlg?.close();
    s.ui.exportOpen = false;
  });
  dlg.showModal();
  return () => s.layers.drop("export");
});

// the preview follows the options (debounced; the latest answer wins)
$effect(() => {
  const req = { format: "html" as const, level, lang, includeDecisions: decisions, excerpts };
  const ws = s.workspace.key;
  if (!ws) return;
  const id = ++seq;
  busy = true;
  error = null;
  const h = setTimeout(() => {
    s.api.call("POST /ws/:ws/export", { params: { ws }, body: req }).then(
      (r) => {
        if (id !== seq) return;
        res = r;
        resExcerpts = req.excerpts;
        busy = false;
      },
      (err) => {
        if (id !== seq) return;
        res = null;
        busy = false;
        error = errorText(MitoriError.from(err).toData());
      },
    );
  }, 250);
  return () => clearTimeout(h);
});

function close() {
  s.ui.exportOpen = false;
  s.layers.close("export");
}

function download() {
  const r = res;
  if (!r) return;
  const url = URL.createObjectURL(new Blob([r.html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(s.doc.outline?.manifest.title ?? s.workspace.status?.info.name ?? "mitori", new Date());
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  s.bottom.toast({ id: "export.done", kind: "success", key: "exportDlg.toast", params: { name: a.download, size: fmtBytes(r.bytes) } });
  close();
}

const LEVELS: ReaderLevel[] = ["newcomer", "standard", "expert"];
</script>

<dialog class="dlg exp" bind:this={dlg} aria-modal="true" aria-labelledby="exp-t" oncancel={(e) => (e.preventDefault(), close())} data-chrome>
  <div class="hd">
    <h2 id="exp-t">{t("exportDlg.title")}</h2>
    <button type="button" class="icon-btn" aria-label={t("help.close")} onclick={close}>&times;</button>
  </div>
  <p class="lead">{t("exportDlg.lead")}</p>

  <div class="opts">
    <div class="opt">
      <span class="k" id="exp-level">{t("exportDlg.level")}</span>
      <div class="seg" role="radiogroup" aria-labelledby="exp-level">
        {#each LEVELS as l (l)}
          <label class:on={level === l}><input type="radio" name="exp-level" value={l} checked={level === l} onchange={() => (level = l)} />{t(`level.${l}`)}</label>
        {/each}
      </div>
    </div>
    <div class="opt">
      <span class="k" id="exp-lang">{t("exportDlg.lang")}</span>
      <div class="seg" role="radiogroup" aria-labelledby="exp-lang">
        <label class:on={lang === "ja"}><input type="radio" name="exp-lang" value="ja" checked={lang === "ja"} onchange={() => (lang = "ja")} />{t("settings.langJa")}</label>
        <label class:on={lang === "en"}><input type="radio" name="exp-lang" value="en" checked={lang === "en"} onchange={() => (lang = "en")} />{t("settings.langEn")}</label>
      </div>
    </div>
    <label class="opt check"><input type="checkbox" bind:checked={decisions} /><span>{t("exportDlg.decisions")}</span></label>
    <label class="opt check"
      ><input type="checkbox" bind:checked={excerpts} /><span
        >{t("exportDlg.excerpts")}<span class="hint">{t(excerpts ? "exportDlg.excerptsOn" : "exportDlg.excerptsOff")}</span></span
      ></label
    >
  </div>

  <div class="sum" aria-live="polite" aria-busy={busy}>
    {#if error}
      <p class="err" role="alert">{error}</p>
    {:else if res}
      <p class="facts" class:stale={busy}>
        <b class="mono">{fmtBytes(res.bytes)}</b>
        <span class="sep" aria-hidden="true">·</span>
        <span>{resExcerpts ? t("exportDlg.codeExcerpts", { n: res.codeExcerpts.count, files: res.codeExcerpts.files }) : t("exportDlg.noCode")}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span class:warn={res.redactions > 0}>{t("exportDlg.redactions", { n: res.redactions })}</span>
      </p>
      {#if busy}<p class="upd">{t("exportDlg.updating")}</p>{/if}
    {:else}
      <p class="upd">{t("exportDlg.preparing")}</p>
    {/if}
  </div>

  <div class="ft">
    <button type="button" class="btn btn-gh" onclick={close}>{t("exportDlg.cancel")}</button>
    <button type="button" class="btn btn-pri" disabled={!res || busy} onclick={download}>{t("exportDlg.download")}</button>
  </div>
</dialog>

<style>
  .exp {
    width: 560px;
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .lead {
    margin: 0 0 16px;
    font-size: var(--fs-ui-s);
    line-height: 1.7;
    color: var(--muted);
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-size: var(--fs-ui);
    color: var(--text);
  }
  .opt.check {
    justify-content: flex-start;
    gap: 10px;
    cursor: pointer;
  }
  .opt.check > span {
    display: flex;
    flex-direction: column;
  }
  .hint {
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .k {
    color: var(--text);
  }
  .seg label.on {
    background: var(--sheet);
    color: var(--ink);
    font-weight: var(--fw-strong);
  }
  .sum {
    margin: 18px 0 0;
    padding: 12px 14px;
    min-height: 46px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--paper);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    margin: 0;
    font-size: var(--fs-ui-s);
    color: var(--text);
  }
  .facts.stale {
    opacity: 0.55;
  }
  .facts .warn {
    color: var(--c-warn);
  }
  .sep {
    color: var(--muted);
  }
  .upd,
  .err {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .err {
    color: var(--c-bad);
  }
  .ft {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
