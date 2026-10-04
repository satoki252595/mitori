<script lang="ts">
import { t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { loopOf } from "./loop.svelte.ts";

const loop = loopOf(useStores());
const changes = $derived(loop.roundChanges);
const busy = $derived(loop.roundChangesLoading || loop.roundUndoing);
</script>

{#if loop.completedPull !== null}
  <section class="round card" aria-label={t("review.round.title", { n: loop.completedPull })} data-chrome>
    <h3>{t("review.round.title", { n: loop.completedPull })}</h3>
    {#if changes}
      <p class:outside={changes.outside.length > 0} role="status">{t(changes.outside.length ? "review.round.outside" : "review.round.inside", { n: changes.outside.length })}</p>
      {#if changes.files.length}
        <p>{t("review.round.files", { n: changes.files.length })}</p>
        <ul class="files mono">
          {#each changes.files as file (file)}
            <li><span data-user-content>{file}</span>{#if changes.outside.includes(file)} <span class="outside">· {t("review.round.marker")}</span>{/if}</li>
          {/each}
        </ul>
        <p>{t("review.round.warning")}</p>
      {:else}
        <p>{t("review.round.empty")}</p>
      {/if}
    {:else if loop.roundChangesLoading}
      <p role="status">{t("review.round.loading")}</p>
    {/if}
    {#if loop.roundChangesError}<p class="outside" role="alert">{loop.roundChangesError}</p>{/if}
    <div class="actions">
      <button type="button" class="btn btn-gh btn-s" disabled={busy} onclick={() => void loop.refreshRoundChanges()}>{t("review.round.refresh")}</button>
      <button type="button" class="btn btn-sec btn-s" disabled={busy || !changes?.files.length} onclick={() => void loop.undoRound()}>{t(loop.roundUndoing ? "review.round.undoing" : "review.round.undo")}</button>
    </div>
  </section>
{/if}

<style>
  .round {
    margin: 12px 16px;
    padding: 12px 16px;
    font-size: var(--fs-label);
    overflow-wrap: anywhere;
  }
  h3,
  p {
    margin: 0 0 8px;
  }
  h3 {
    font-size: var(--fs-label);
  }
  .files {
    margin: 0 0 8px;
    padding-left: 1.2em;
    max-height: 180px;
    overflow: auto;
  }
  .outside {
    color: var(--c-warn);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
