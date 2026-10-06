/** Official CLI sign-in targets. Browser requests never supply executable paths or arguments. */
export const PROVIDER_AUTH_IDS = ["claude", "muse", "codex", "cursor", "antigravity", "grok", "ollama"] as const;
export type ProviderAuthId = (typeof PROVIDER_AUTH_IDS)[number];
