<!--
  Lazy component host: the shell loads every loop `ui.ts` at boot (shell/ext.ts), so the loop's views are imported
  only when they are actually shown — the Review panel on S5, the Inbox on S4, the margin cards once the page has a
  card. Keeps the boot chunk small (initial JS ≤ 150 KB hard, ux.md §13.1).
  CR-PENDING(WP-10b): lazy loaders in `UiExtension` (docs/design/cr-requests/WP-10b.md "lazy extension views").
-->
<script lang="ts">
import type { Component } from "svelte";

let {
  load,
  props = {},
  fallback = null,
}: { load: () => Promise<{ default: Component<never> }>; props?: Record<string, unknown>; fallback?: import("svelte").Snippet | null } = $props();
let C = $state.raw<Component<Record<string, unknown>> | null>(null);
$effect(() => {
  const l = load;
  let live = true;
  void l().then((m) => {
    if (live) C = m.default as unknown as Component<Record<string, unknown>>;
  });
  return () => {
    live = false;
  };
});
</script>

{#if C}
  <C {...props} />
{:else if fallback}
  {@render fallback()}
{/if}
