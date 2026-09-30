const CMU_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict";
let cache = null;
let cacheTime = 0;
const TTL = 86400000; // 24h

async function getDict() {
  if (cache && Date.now() - cacheTime < TTL) return cache;
  const resp = await fetch(CMU_URL);
  if (!resp.ok) throw new Error("Failed to fetch CMU dict");
  const text = await resp.text();
  const dict = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(";;;")) continue;
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx < 0) continue;
    let word = line.slice(0, spaceIdx).toLowerCase();
    // strip variant suffix like "read(2)"
    const parenIdx = word.indexOf("(");
    if (parenIdx > 0) word = word.slice(0, parenIdx);
    const phonemes = line.slice(spaceIdx + 1).trim();
    if (!dict[word]) dict[word] = [];
    dict[word].push(phonemes);
  }
  cache = dict;
  cacheTime = Date.now();
  return dict;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const word = searchParams.get("word")?.toLowerCase();
  if (!word) return Response.json({ error: "word param required" }, { status: 400 });

  try {
    const dict = await getDict();
    const entries = dict[word];
    if (!entries) return Response.json({ word, phonemes: null, rhymes: [] });

    // get last stressed vowel + everything after for rhyme matching
    const primary = entries[0].split(" ");
    const stressIdx = primary.findLastIndex((p) => /[012]$/.test(p));
    const rhymeTail = stressIdx >= 0 ? primary.slice(stressIdx).join(" ") : "";

    // find rhymes: same tail, different word
    const rhymes = [];
    if (rhymeTail) {
      for (const [w, pronunciations] of Object.entries(dict)) {
        if (w === word) continue;
        for (const pron of pronunciations) {
          const phones = pron.split(" ");
          const si = phones.findLastIndex((p) => /[012]$/.test(p));
          const tail = si >= 0 ? phones.slice(si).join(" ") : "";
          if (tail === rhymeTail) { rhymes.push(w); break; }
        }
        if (rhymes.length >= 100) break;
      }
    }

    return Response.json({
      word,
      phonemes: entries,
      syllables: primary.filter((p) => /[012]$/.test(p)).length,
      stress: primary.filter((p) => /[012]$/.test(p)).map((p) => p.slice(-1)).join(""),
      rhymes: rhymes.slice(0, 100),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
