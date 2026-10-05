/** Immutable Vite build assets are read as JSON data, without API credentials or executable imports. */
export async function fetchCatalog(urls: readonly string[]): Promise<Record<string, string>> {
  const parts = await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`catalog: ${response.status}`);
      return response.json() as Promise<Record<string, string>>;
    }),
  );
  return Object.assign({}, ...parts);
}
