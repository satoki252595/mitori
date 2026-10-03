/** Clipboard writes with a success / failure toast. */
import type { Stores } from "../stores/app.svelte.ts";

export async function copyText(text: string, s: Pick<Stores, "bottom">, toastKey: string, params?: Record<string, string | number>): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    s.bottom.toast({ id: `copy`, kind: "success", key: `toast.${toastKey}`, ...(params ? { params } : {}) });
    return true;
  } catch {
    s.bottom.toast({ id: `copy`, kind: "warn", key: "toast.copyFailed" });
    return false;
  }
}
