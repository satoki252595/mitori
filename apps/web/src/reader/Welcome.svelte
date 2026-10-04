<!--
  §0's welcome card (NC-08 / NC-13): where a newcomer starts — the 5-minute course (§0 → §1 → §2 → §3, its real
  time), the reader level it reads at, and the one line that says what the document is FOR (select a sentence, ask
  or fix with AI). Shown on the first visits of a workspace until dismissed (×) or the course is done; once the
  course has started it shows the next stop instead of the invitation. Rendered with the section (no layout shift).
-->
<script lang="ts">
import { HREFS, type ReaderLevel, type ReadingPath, type SectionId, type WorkspaceKey } from "@mitori/core";
import { hasKey } from "../shell/i18n.ts";
import { t } from "../shell/index.ts";
import Rich from "../shell/Rich.svelte";
import { type PathProgress, pathName } from "../shell/reading.ts";

let {
  ws,
  path,
  prog,
  level,
  numbers,
  titles,
  onstart,
  onlevel,
  onclose,
}: {
  ws: WorkspaceKey;
  path: ReadingPath;
  prog: PathProgress;
  level: ReaderLevel;
  numbers: (id: SectionId) => string;
  titles: (id: SectionId) => string;
  onstart: () => void;
  onlevel: (l: ReaderLevel) => void;
  onclose: () => void;
} = $props();

const name = $derived(pathName(path, prog.totalMin, t, hasKey));
const stops = $derived(prog.stops.map((s) => `§${numbers(s.section)}`).join(" → "));
const started = $derived(prog.read > 0);
</script>

<aside class="welcome" aria-labelledby="welcome-t" data-chrome>
  <button type="button" class="x" aria-label={t("reader.welcome.close")} onclick={onclose}>&times;</button>
  <p class="k" id="welcome-t">{t("reader.welcome.title", { name })}</p>
  <p class="stops mono">{t("reader.welcome.stops", { stops, min: prog.totalMin })}</p>
  <p class="line"><Rich text={t(level === "newcomer" ? "reader.welcome.newcomerLine" : "reader.welcome.standardLine")} /></p>
  <div class="acts">
    {#if started && prog.next}
      <a class="btn btn-pri btn-s" href={HREFS.doc(ws, prog.next)} onclick={onstart}>{t("reader.welcome.continue", { num: numbers(prog.next), title: titles(prog.next) })}</a>
    {:else}
      <button type="button" class="btn btn-pri btn-s" onclick={onstart}>{t("reader.welcome.start", { name })}</button>
    {/if}
    {#if level === "newcomer"}
      <button type="button" class="btn btn-gh btn-s" onclick={() => onlevel("standard")}>{t("reader.welcome.standard")}</button>
    {:else}
      <button type="button" class="btn btn-gh btn-s" onclick={() => onlevel("newcomer")}>{t("reader.welcome.newcomerLevel")}</button>
    {/if}
  </div>
</aside>

<style>
  .welcome {
    position: relative;
    margin: 0 0 28px;
    padding: 16px 44px 16px 18px;
    border: 1px solid var(--rule);
    border-radius: var(--r-card);
    background: var(--paper-2);
  }
  .k {
    margin: 0;
    font-size: var(--fs-ui);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  .stops {
    margin: 2px 0 8px;
    font-size: var(--fs-label);
    color: var(--muted);
  }
  .line {
    margin: 0 0 12px;
    font-size: var(--fs-ui-s);
    line-height: 1.75;
    color: var(--text);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .x {
    position: absolute;
    right: 8px;
    top: 8px;
    width: 28px;
    height: 28px;
    border-radius: var(--r-btn);
    color: var(--muted);
    font-size: 1.125rem;
  }
  .x:hover {
    background: var(--hover);
    color: var(--ink);
  }
</style>
