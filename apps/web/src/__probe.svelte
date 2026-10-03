<!--
  svelte-check probe (WP-00a acceptance, SC-08): proves .svelte type-checking runs with TypeScript 6.0.3 and
  runes. Delete once WP-10a has real components.
-->
<script lang="ts">
import type { UiLang } from "@mitori/core";

let { lang = "ja" }: { lang?: UiLang } = $props();
let count = $state(0);
const label = $derived(lang === "ja" ? `押した回数: ${count}` : `clicks: ${count}`);
</script>

<button type="button" onclick={() => count++}>{label}</button>
