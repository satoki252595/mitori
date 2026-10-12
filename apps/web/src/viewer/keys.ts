/** Apple platform (the palette hint says ⌘K, otherwise Ctrl K). */
export function isMacPlatform(nav: Navigator): boolean {
  return /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent);
}

/** A key pressed here belongs to the control, not to the viewer's single-key shortcuts (text fields, selects). */
export function typingTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || typeof e.tagName !== "string") return false;
  if (e.isContentEditable || e.tagName === "TEXTAREA" || e.tagName === "SELECT") return true;
  // a focused radio (the level switch) or checkbox does not swallow `-` / `=` / `0`
  return e.tagName === "INPUT" && !/^(?:radio|checkbox|button|submit|reset|range)$/.test((e as HTMLInputElement).type);
}
