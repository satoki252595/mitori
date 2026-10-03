<!--
  Stub shell (WP-11a walking skeleton): proves the Svelte 5 dist is built, precompressed, embedded and served under
  the daemon's CSP. Replaced by WP-10a's shell.
-->
<script lang="ts">
import type { HealthRes } from "@mitori/core";

let health = $state<HealthRes | null>(null);
let failed = $state(false);

fetch("/api/v1/health")
  .then((r) => r.json() as Promise<HealthRes>)
  .then((h) => {
    health = h;
  })
  .catch(() => {
    failed = true;
  });
</script>

<main>
  <h1>mitori <span>見取り図</span></h1>
  <p class="status">
    {#if health}
      daemon {health.version} · pid {health.pid} · {health.build}
    {:else if failed}
      daemon unreachable
    {:else}
      connecting…
    {/if}
  </p>
  <p class="note">walking skeleton — the shell arrives with WP-10a</p>
</main>

<style>
  main {
    max-width: 40rem;
    margin: 18vh auto 0;
    padding: 0 1.5rem;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", "Yu Gothic UI", sans-serif;
    color: #2b2925;
  }
  h1 {
    font-family: ui-serif, "Hiragino Mincho ProN", "Yu Mincho", serif;
    font-weight: 600;
    font-size: 1.75rem;
    margin: 0 0 0.75rem;
  }
  h1 span {
    font-weight: 400;
    color: #6b665e;
  }
  .status {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.8125rem;
  }
  .note {
    color: #6b665e;
    font-size: 0.8125rem;
  }
</style>
