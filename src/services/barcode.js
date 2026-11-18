// Code 128 (B to'plami) shtrix-kodi — muxlislik kartasining orqa tomonidagi bot havolasi uchun.
// Natija — SVG <rect> elementlari (tashqi kutubxonasiz).
const PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');
const START_B = 104;
const STOP = 106;

/** Matn → modullar qatori ('1' — qora chiziq, '0' — oraliq). Faqat ASCII 32–126. */
function modules(text) {
  const chars = [...String(text)].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126);
  const codes = [START_B, ...chars.map((ch) => ch.charCodeAt(0) - 32)];
  const checksum = codes.reduce((s, c, i) => s + c * (i || 1), 0) % 103;
  codes.push(checksum, STOP);
  let out = '';
  for (const c of codes) [...PATTERNS[c]].forEach((w, i) => { out += (i % 2 ? '0' : '1').repeat(Number(w)); });
  return out;
}

/** SVG chiziqlari: x, y, kenglik, balandlik ichiga joylashtiriladi */
function svgBars(text, x, y, width, height, color = '#000') {
  const m = modules(text);
  const unit = width / m.length;
  let bars = '';
  for (let i = 0; i < m.length;) {
    if (m[i] !== '1') { i += 1; continue; }
    let j = i;
    while (m[j] === '1') j += 1;
    bars += `<rect x="${(x + i * unit).toFixed(2)}" y="${y}" width="${((j - i) * unit).toFixed(2)}" height="${height}"/>`;
    i = j;
  }
  return `<g fill="${color}">${bars}</g>`;
}

module.exports = { modules, svgBars };
