// WAV container helpers shared by bridge.mjs and the tests (no server side effects).

/**
 * Parse a WAV container and return { bytes: raw-PCM Uint8Array, rate }.
 * Walks RIFF chunks, reading the sample rate from "fmt " and the payload from
 * "data". Falls back to the classic 44-byte-header layout if no "data" chunk is
 * found. Never throws on malformed input — returns the best-effort slice.
 */
export function wavToPCM(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let rate = 24000, off = 44, len = Math.max(0, u8.byteLength - 44);
  let p = 12;
  while (p + 8 <= u8.byteLength) {
    const id = String.fromCharCode(u8[p], u8[p+1], u8[p+2], u8[p+3]);
    const sz = dv.getUint32(p + 4, true);
    if (id === "fmt ") rate = dv.getUint32(p + 12, true) || rate;
    if (id === "data") { off = p + 8; len = sz; break; }
    p += 8 + sz + (sz % 2);
  }
  const end = Math.min(off + len, u8.byteLength);
  return { bytes: u8.slice(off, end), rate };
}

/** Build a minimal 16-bit mono PCM WAV container around raw PCM bytes. */
export function pcmToWav(pcm, rate = 24000) {
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); dv.setUint32(4, 36 + pcm.byteLength, true); wstr(8, "WAVE");
  wstr(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);   // PCM, mono
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, "data"); dv.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}
