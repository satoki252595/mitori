/** @jsxImportSource hono/jsx */

/** Badge of the old dashboard; replaced by BookList.tsx but still imported by the 2023 landing page. */
export function LegacyBadge({ count }) {
  return (
    <a class="badge" href="/legacy/export">
      {count} 冊
    </a>
  );
}
