/** Native chrome updates retain controls so an open LayerStack can restore its original DOM opener. */
export function replaceChrome(host: HTMLElement, html: string): void {
  const key = (el: Element) =>
    `${el.tagName}|${["data-act", "data-id", "data-toc", "href", "type", "name", "value"].map((a) => el.getAttribute(a) ?? "").join("|")}`;
  const controls = new Map<string, Element[]>();
  for (const el of host.querySelectorAll("button,a[href],input")) {
    const k = key(el);
    const list = controls.get(k) ?? [];
    list.push(el);
    controls.set(k, list);
  }
  const active = document.activeElement as HTMLElement | null;
  const focused = active !== null && host.contains(active);
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const next of template.content.querySelectorAll("button,a[href],input")) {
    const old = controls.get(key(next))?.shift();
    if (!old) continue;
    for (const a of [...old.attributes]) if (!next.hasAttribute(a.name)) old.removeAttribute(a.name);
    for (const a of next.attributes) old.setAttribute(a.name, a.value);
    if (old instanceof HTMLInputElement) old.checked = next.hasAttribute("checked");
    else old.innerHTML = next.innerHTML;
    next.replaceWith(old);
  }
  host.replaceChildren(template.content);
  if (focused && active.isConnected) active.focus({ preventScroll: true });
}
