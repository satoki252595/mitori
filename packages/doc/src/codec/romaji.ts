// Hepburn romaji of a kana reading for ⌘K lookup (§5.6.9): `にんしょう` → `ninshou`. Lowercase, no spaces; long
// vowels are spelled out (`ou`, `ー` repeats the vowel), っ doubles the next consonant (`tch` for ち), ん → `n`.

// biome-ignore format: kana table
const BASE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};

/** Digraphs (consonant + small ya/yu/yo, and a few loanword combinations). */
// biome-ignore format: kana table
const DIGRAPH: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho", ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo", ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo", じゃ: "ja", じゅ: "ju", じょ: "jo",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo", びゃ: "bya", びゅ: "byu", びょ: "byo", ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  しぇ: "she", ちぇ: "che", じぇ: "je", てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du", ふぁ: "fa", ふぃ: "fi",
  ふぇ: "fe", ふぉ: "fo", うぃ: "wi", うぇ: "we", うぉ: "wo", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso", いぇ: "ye",
};

/** Katakana → hiragana (ー is kept). */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Hepburn romaji of a reading (hiragana or katakana). Non-kana characters pass through lowercased; spaces removed. */
export function toRomaji(yomi: string): string {
  const s = toHiragana(yomi.normalize("NFKC"));
  let out = "";
  let geminate = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === "っ") {
      geminate = true;
      continue;
    }
    if (c === "ー") {
      const v = /[aeiou]$/.exec(out)?.[0];
      if (v) out += v;
      continue;
    }
    const pair = s.slice(i, i + 2);
    let r = DIGRAPH[pair];
    if (r) i++;
    else r = BASE[c] ?? c.toLowerCase();
    if (geminate) {
      if (/^[a-z]/.test(r) && !/^[aeiou]/.test(r)) out += r.startsWith("ch") ? "t" : r[0];
      geminate = false;
    }
    out += r;
  }
  return out.replace(/\s+/g, "");
}
