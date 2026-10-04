/** NC-01: the Composer's textarea gets focus after its margin slot is placed (no click needed). */
import { describe, expect, test } from "bun:test";
import { focusWhenShown } from "./focus.ts";

function fakeEl(tag = "TEXTAREA") {
  const state = {
    visible: false,
    focused: false as boolean,
    active: { tagName: "DIV", classList: { contains: (c: string) => c === "blk" } } as unknown as Element,
  };
  const el = {
    tagName: tag,
    classList: { contains: () => false },
    focus() {
      if (state.visible) state.active = el as unknown as Element;
    },
  } as unknown as HTMLElement;
  return { el, state };
}

function deps(state: { visible: boolean; active: Element }, onFrame: (n: number) => void) {
  let frames = 0;
  const queue: (() => void)[] = [];
  return {
    d: {
      raf: (fn: () => void) => queue.push(fn),
      visible: () => state.visible,
      active: () => state.active,
    },
    run() {
      while (queue.length) {
        frames++;
        onFrame(frames);
        (queue.shift() as () => void)();
      }
      return frames;
    },
  };
}

describe("NC-01 focusWhenShown", () => {
  test("hidden for 3 frames (slot not placed yet), then visible: focus lands on the textarea", async () => {
    const { el, state } = fakeEl();
    const f = deps(state, (n) => {
      if (n === 3) state.visible = true;
    });
    const p = focusWhenShown(el, 30, f.d);
    f.run();
    expect(await p).toBe(true);
    expect(state.active).toBe(el as unknown as Element);
  });

  test("a focus() while hidden is not trusted: it retries instead of giving up", async () => {
    const { el, state } = fakeEl();
    // `visible` lies once (the old one-shot tick().focus() path): focus() does nothing, so the next frame retries
    let calls = 0;
    const f = deps(state, () => {
      state.visible = true;
    });
    const d = { ...f.d, visible: () => (calls++ === 0 ? true : state.visible) };
    const p = focusWhenShown(el, 30, d);
    f.run();
    expect(await p).toBe(true);
  });

  test("never placed: gives up after maxFrames, no endless loop", async () => {
    const { el, state } = fakeEl();
    const f = deps(state, () => {});
    const p = focusWhenShown(el, 10, f.d);
    expect(f.run()).toBe(10);
    expect(await p).toBe(false);
  });

  test("the reader focused another input meanwhile: focus is not stolen", async () => {
    const { el, state } = fakeEl();
    const f = deps(state, (n) => {
      if (n === 1) state.active = { tagName: "INPUT", classList: { contains: () => false } } as unknown as Element;
      if (n === 2) state.visible = true;
    });
    const p = focusWhenShown(el, 30, f.d);
    f.run();
    expect(await p).toBe(false);
    expect((state.active as { tagName: string }).tagName).toBe("INPUT");
  });
});
