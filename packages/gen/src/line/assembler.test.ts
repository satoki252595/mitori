import { describe, expect, test } from "bun:test";
import { createAssembler } from "./assembler.ts";
import { createLineAssembler } from "./index.ts";

const reply = [
  '{"t":"block","id":"new:1","aspect":"responsibility","md":"設計書を生成する[[1]]。\\n次に検証する。","claims":{"1":"fact"}}',
  '{"t":"module","module":"md_7hq2m4xa","name":"生成"}',
  '{"t":"end","blocks":1}',
].join("\n");

function feed(chunks: string[]): string[] {
  const a = createLineAssembler();
  const out = chunks.flatMap((c) => a.push(c));
  const rest = a.end();
  return rest === null ? out : [...out, rest];
}

describe("GEN-U-018 one-character deltas give the same lines", () => {
  test("whole vs per-char vs 7-char chunks", () => {
    const whole = feed([reply]);
    expect(whole).toEqual(reply.split("\n"));
    expect(feed([...reply])).toEqual(whole);
    const sevens: string[] = [];
    for (let i = 0; i < reply.length; i += 7) sevens.push(reply.slice(i, i + 7));
    expect(feed(sevens)).toEqual(whole);
  });
});

describe("GEN-U-019 multibyte text split across deltas", () => {
  test("a surrogate pair and CJK split between chunks are reassembled", () => {
    const line = '{"t":"term","term":"設計","def":"😀を含む"}';
    const at = line.indexOf("😀") + 1; // inside the surrogate pair
    expect(feed([line.slice(0, at), line.slice(at), "\n"])).toEqual([line]);
  });
});

describe("assembler framing", () => {
  test("CRLF, BOM and leading whitespace are stripped; the unterminated last line comes from end()", () => {
    const a = createLineAssembler();
    expect(a.push('﻿  {"t":"end","blocks":0}\r\n{"t":')).toEqual(['{"t":"end","blocks":0}']);
    expect(a.end()).toBe('{"t":');
    expect(a.end()).toBeNull();
  });

  test("partial() decodes the open block's md so far without markers", () => {
    const a = createAssembler();
    a.push('{"t":"block","id":"new:1","section":"s6/x","aspect":"interface","md":"- `Get` は値を返す[[1]]。\\n- `P');
    expect(a.partial()).toEqual({ section: "s6/x", md: "- `Get` は値を返す。\n- `P", aspect: "interface" });
    a.push("ut` は保存する[[");
    expect(a.partial()?.md).toBe("- `Get` は値を返す。\n- `Put` は保存する");
    a.push('2]]","claims":{}}\n{"t":"module"');
    expect(a.partial()).toBeNull();
  });

  test("partial() is null before md and for non-block lines", () => {
    const a = createAssembler();
    a.push('{"t":"block","id":"new:1"');
    expect(a.partial()).toBeNull();
    a.push(',"aspect":"learn","md":"\\u3042');
    expect(a.partial()?.md).toBe("あ");
  });
});
