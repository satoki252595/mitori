<!--
  Inline SVG icons (never emoji; ux.md §6.9). Stroke icons share one 16×16 grid; `aria-hidden` always — the
  owning control carries the accessible name.
-->
<script lang="ts" module>
const PATHS = {
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5",
  theme: "M8 1.5a6.5 6.5 0 1 0 0 13ZM8 1.5a6.5 6.5 0 0 1 0 13",
  help: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  x: "M4 4l8 8M12 4l-8 8",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  check: "M3 8.5l3 3 7-7",
  chev: "M6 4l4 4-4 4",
  down: "M4 6l4 4 4-4",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  fit: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  play: "M5 3.5l7 4.5-7 4.5z",
  stop: "M4 4h8v8H4z",
  refresh: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3",
  term: "M2.5 4l3.5 4-3.5 4M8 12h5.5",
  key: "M10 6.5a3 3 0 1 1-2.4 4.8L4 14.5H2.5V13l3.6-3.6A3 3 0 0 1 10 6.5Z",
  warn: "M8 2l6.5 11.5h-13ZM8 6.5v3.2M8 11.6v.1",
  info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 7.3v4M8 4.8v.1",
  layers: "M8 2l6.5 3.5L8 9 1.5 5.5ZM1.5 8.5 8 12l6.5-3.5",
  comment: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2Z",
  explain: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.4.2-.7.5-.7 1v.3M8 11.3v.1",
  fix: "M10.5 2.5l3 3-7.5 7.5H3v-3Z",
  ext: "M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v4H2.5V4h4",
  clock: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5",
} as const;
export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg class="i" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>
