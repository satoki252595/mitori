// IME simulation (testing spec §5.3). Chromium: CDP `Input.imeSetComposition` / `Input.insertText` with the 229-keydowns a
// real IME produces. WebKit has no CDP, so Safari's event order is dispatched synthetically; handlers must not look at
// `isTrusted` (ui spec). The synthetic path is browser-agnostic and also runs in Chromium for order-specific tests.
import { MitoriError } from "@mitori/core";
import type { PageLike } from "../contract.ts";
import { asPwPage, type CdpSessionLike, cdp } from "./page.ts";

type Order = "chromium" | "webkit";
type ConfirmKey = "Enter" | "Escape";

const ROWS: Readonly<Record<string, string>> = {
  あいうえおぁぃぅぇぉ: "A",
  かきくけこ: "K",
  がぎぐげご: "G",
  さしすせそ: "S",
  ざじずぜぞ: "Z",
  たちつてとっ: "T",
  だぢづでど: "D",
  なにぬねの: "N",
  はひふへほ: "H",
  ばびぶべぼ: "B",
  ぱぴぷぺぽ: "P",
  まみむめも: "M",
  やゆよゃゅょ: "Y",
  らりるれろ: "R",
  わをー: "W",
  ん: "N",
};

/** `KeyX` for the key that would start this kana on a romaji keyboard (the first letter is all a handler can observe). */
function keyCodeFor(ch: string): string {
  const kana = ch.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)); // katakana → hiragana
  for (const [chars, letter] of Object.entries(ROWS)) if (chars.includes(kana)) return `Key${letter}`;
  return /^[a-z]$/i.test(ch) ? `Key${ch.toUpperCase()}` : "KeyA";
}

async function key(s: CdpSessionLike, type: "keyDown" | "keyUp", k: string, code: string): Promise<void> {
  await s.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: 229 });
}

async function composeChromium(page: PageLike, reading: string, commit: string | null, confirm: ConfirmKey): Promise<void> {
  const s = await cdp(asPwPage(page));
  let shown = "";
  for (const ch of reading) {
    shown += ch;
    const code = keyCodeFor(ch);
    await key(s, "keyDown", "Process", code);
    await s.send("Input.imeSetComposition", { text: shown, selectionStart: shown.length, selectionEnd: shown.length });
    await key(s, "keyUp", "Process", code);
  }
  if (confirm === "Escape" || commit === null) {
    await key(s, "keyDown", "Escape", "Escape");
    await s.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
    await key(s, "keyUp", "Escape", "Escape");
  } else {
    await key(s, "keyDown", "Enter", "Enter");
    await s.send("Input.insertText", { text: commit });
    await key(s, "keyUp", "Enter", "Enter");
  }
}

/** Page-side: Safari order — compositionstart, update×n, keydown(229, composing), compositionend, keydown(229, not composing). */
const SYNTH = `(args) => {
  const { reading, commit, confirm, codes } = args;
  const el = document.activeElement;
  if (!el) throw new Error("ime.compose: nothing is focused");
  const isText = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const base = { bubbles: true, cancelable: true, composed: true };
  const comp = (type, data) => el.dispatchEvent(new CompositionEvent(type, { ...base, data, bubbles: true }));
  const input = (inputType, data, isComposing) => el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType, data, isComposing }));
  const keydown = (k, code, isComposing) => {
    const e = new KeyboardEvent("keydown", { ...base, key: k, code, isComposing });
    Object.defineProperty(e, "keyCode", { get: () => 229 });
    Object.defineProperty(e, "which", { get: () => 229 });
    el.dispatchEvent(e);
  };
  let start = isText ? el.selectionStart ?? el.value.length : 0;
  let len = 0;
  const show = (text) => {
    if (!isText) return;
    el.setRangeText(text, start, start + len, "end");
    len = text.length;
  };
  comp("compositionstart", "");
  let shown = "";
  for (const [i, ch] of [...reading].entries()) {
    shown += ch;
    keydown("Process", codes[i], true);
    comp("compositionupdate", shown);
    show(shown);
    input("insertCompositionText", shown, true);
  }
  if (confirm === "Escape" || commit === null) {
    keydown("Escape", "Escape", true);
    show("");
    comp("compositionend", "");
    input("insertCompositionText", null, false);
  } else {
    keydown("Enter", "Enter", true);
    show(commit);
    if (!isText) document.execCommand("insertText", false, commit);
    comp("compositionend", commit);
    input("insertFromComposition", commit, false);
    keydown("Enter", "Enter", false);
  }
}`;

async function composeSynthetic(page: PageLike, reading: string, commit: string | null, confirm: ConfirmKey): Promise<void> {
  const codes = [...reading].map(keyCodeFor);
  await asPwPage(page).evaluate(`(${SYNTH})(${JSON.stringify({ reading, commit, confirm, codes })})`);
}

export async function compose(page: PageLike, reading: string, commit: string | null, opts: { order: Order; confirmKey?: ConfirmKey }): Promise<void> {
  if (reading === "") throw new MitoriError("E_INVALID_INPUT", "ime.compose: reading must not be empty");
  const confirm = opts.confirmKey ?? (commit === null ? "Escape" : "Enter");
  if (opts.order === "chromium") return composeChromium(page, reading, commit, confirm);
  return composeSynthetic(page, reading, commit, confirm);
}

/** A single key while the IME is on: `keydown` with `key: "Process"`, `keyCode: 229` and the physical `code`. */
export async function imeKey(page: PageLike, code: string): Promise<void> {
  const p = asPwPage(page);
  try {
    const s = await cdp(p);
    await key(s, "keyDown", "Process", code);
    await key(s, "keyUp", "Process", code);
  } catch (err) {
    if (!(err instanceof MitoriError) || err.code !== "E_UNSUPPORTED") throw err;
    await p.evaluate(
      `((code) => {
        const el = document.activeElement ?? document.body;
        for (const type of ["keydown", "keyup"]) {
          const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, key: "Process", code, isComposing: false });
          Object.defineProperty(e, "keyCode", { get: () => 229 });
          Object.defineProperty(e, "which", { get: () => 229 });
          el.dispatchEvent(e);
        }
      })(${JSON.stringify(code)})`,
    );
  }
}
