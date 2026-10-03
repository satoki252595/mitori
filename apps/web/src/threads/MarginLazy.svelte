<!--
  `UiExtension.margin`: the margin cards and the Composer live in their own chunk, fetched as soon as the page has
  something to show there (a thread anchored on it, or an open Composer) and warmed in idle time otherwise, so a
  Composer opens without a network round trip.
-->
<script lang="ts" module>
const load = () => import("./Margin.svelte");
</script>

<script lang="ts">
import { onMount } from "svelte";
import { useStores } from "../stores/app.svelte.ts";
import Lazy from "./Lazy.svelte";
import { loopOf } from "./loop.svelte.ts";

let { page }: { page: string } = $props();
const s = useStores();
const loop = loopOf(s);

function onPage(block: string | undefined): boolean {
  if (!block) return false;
  const sec = s.doc.index?.blockSection.get(block as `b_${string}`);
  return !!sec && (s.doc.index?.pageOf.get(sec) ?? sec) === page;
}
const needed = $derived(onPage(loop.composer?.target.block) || [...s.review.threads.values()].some((t) => onPage(t.anchor.doc?.block)));

onMount(() => {
  const idle = setTimeout(() => void load(), 1500);
  return () => clearTimeout(idle);
});
</script>

{#if needed}<Lazy {load} props={{ page }} />{/if}
