/**
 * Opening the browser (ARCHITECTURE §2.2, UXP-01): a 60 s single-use nonce URL (`POST /auth/nonce`, the nonce rides in
 * the fragment), and only when `ui.openBrowser` is on and no tab of the workspace is connected yet (an open tab
 * follows by itself). Never fatal: the plain URL is always printed by the caller.
 */
import type { WorkspaceKey } from "@mitori/core";
import type { Io } from "./io.ts";
import type { Session } from "./session.ts";

/** Open `to` in the browser when appropriate; resolves with the opened login URL, or null when nothing opened. */
export async function openInBrowser(io: Io, s: Session, ws: WorkspaceKey | null, to: string): Promise<string | null> {
  try {
    const settings = await s.api.call("GET /settings", { params: {} });
    if (!settings.settings.ui.openBrowser) return null;
    if (ws !== null && (await s.api.call("GET /ws/:ws", { params: { ws } })).connectedTabs > 0) return null;
    const nonce = await s.api.call("POST /auth/nonce", { params: {}, body: { to } });
    await io.openUrl(nonce.url);
    return nonce.url;
  } catch {
    return null;
  }
}
