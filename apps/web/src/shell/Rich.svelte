<!-- Catalog text with <b> / <kbd> / <code> rendered as nodes (never innerHTML; ux.md §9.2). -->
<script lang="ts">
import { parseRich } from "./rich.ts";

let { text }: { text: string } = $props();
const segs = $derived(parseRich(text));
</script>

{#each segs as s, i (i)}{#if s.tag === "b"}<b>{s.text}</b>{:else if s.tag === "kbd"}<kbd>{s.text}</kbd>{:else if s.tag === "code"}<code>{s.text}</code>{:else}{s.text}{/if}{/each}
