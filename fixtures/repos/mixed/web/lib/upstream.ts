/** URL of the Go API the web app proxies to. */
export function upstream(path: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is not set");
  return new URL(path, base).toString();
}

/** Forward a request to the Go API and relay status and body unchanged. */
export async function relay(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(upstream(path), init);
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}
