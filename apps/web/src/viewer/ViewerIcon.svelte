<!--
  The viewer's icons: the four of shell/Icon.svelte it uses (menu, search, theme, help). A local subset so the
  app's other paths stay out of the export script's budget; keep the paths byte-identical with shell/Icon.svelte.
-->
<script lang="ts" module>
const PATHS = {
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5",
  theme: "M8 1.5a6.5 6.5 0 1 0 0 13ZM8 1.5a6.5 6.5 0 0 1 0 13",
  help: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
} as const;
export type ViewerIconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: ViewerIconName; size?: number } = $props();
</script>

<svg class="i" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>
