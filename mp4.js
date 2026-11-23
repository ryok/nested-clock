// 最小の MP4 マルチプレクサ（H.264 映像1トラック、音声なし、moov を先頭に置く）
// samples: [{ data: Uint8Array(AVCC), key: bool, dur: number(timescale 単位) }]

const enc = new TextEncoder();

function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function u16(n) { return [(n >>> 8) & 255, n & 255]; }
function fourcc(s) { return [...enc.encode(s)]; }

function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function box(type, ...parts) {
  const body = concat(parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p))));
  return concat([Uint8Array.from([...u32(body.length + 8), ...fourcc(type)]), body]);
}
const full = (type, version, flags, ...parts) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);

const MATRIX = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

function moov({ width, height, timescale, samples, description, mdatOffset }) {
  const total = samples.reduce((a, s) => a + s.dur, 0);
  const durMs = Math.round((total / timescale) * 1000);

  const mvhd = full('mvhd', 0, 0, [
    ...u32(0), ...u32(0), ...u32(1000), ...u32(durMs),
    ...u32(0x00010000), ...u16(0x0100), ...u16(0), ...u32(0), ...u32(0),
    ...MATRIX, ...new Array(24).fill(0), ...u32(2),
  ]);
  const tkhd = full('tkhd', 0, 3, [
    ...u32(0), ...u32(0), ...u32(1), ...u32(0), ...u32(durMs),
    ...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
    ...MATRIX, ...u32(width * 65536), ...u32(height * 65536),
  ]);
  const mdhd = full('mdhd', 0, 0, [...u32(0), ...u32(0), ...u32(timescale), ...u32(total), ...u16(0x55c4), ...u16(0)]);
  const hdlr = full('hdlr', 0, 0, [...u32(0), ...fourcc('vide'), ...new Array(12).fill(0), ...enc.encode('VideoHandler'), 0]);
  const vmhd = full('vmhd', 0, 1, new Array(8).fill(0));
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));

  const avc1 = box('avc1', [
    ...new Array(6).fill(0), ...u16(1),
    ...u16(0), ...u16(0), ...new Array(12).fill(0),
    ...u16(width), ...u16(height), ...u32(0x00480000), ...u32(0x00480000),
    ...u32(0), ...u16(1), ...new Array(32).fill(0), ...u16(0x0018), ...u16(0xffff),
  ], box('avcC', description));
  const stsd = full('stsd', 0, 0, u32(1), avc1);

  // 同じ長さが続くところはまとめる
  const runs = [];
  for (const s of samples) {
    const r = runs[runs.length - 1];
    if (r && r[1] === s.dur) r[0]++;
    else runs.push([1, s.dur]);
  }
  const stts = full('stts', 0, 0, u32(runs.length), runs.flatMap(([c, d]) => [...u32(c), ...u32(d)]));
  const keys = [];
  samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  const stss = full('stss', 0, 0, u32(keys.length), keys.flatMap(u32));
  const stsc = full('stsc', 0, 0, u32(1), [...u32(1), ...u32(samples.length), ...u32(1)]);
  const sizes = new Uint8Array(samples.length * 4);
  const dv = new DataView(sizes.buffer);
  samples.forEach((s, i) => dv.setUint32(i * 4, s.data.length));
  const stsz = full('stsz', 0, 0, u32(0), u32(samples.length), sizes);
  const stco = full('stco', 0, 0, u32(1), u32(mdatOffset));

  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
  const minf = box('minf', vmhd, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  return box('moov', mvhd, trak);
}

export function muxMp4({ width, height, timescale, samples, description }) {
  const ftyp = box('ftyp', fourcc('isom'), u32(512), fourcc('isom'), fourcc('iso2'), fourcc('avc1'), fourcc('mp41'));
  // moov の長さは stco の値に依らないので、仮の値で1回作って長さを測る
  const probe = moov({ width, height, timescale, samples, description, mdatOffset: 0 });
  const mdatOffset = ftyp.length + probe.length + 8;
  const head = moov({ width, height, timescale, samples, description, mdatOffset });
  const dataLen = samples.reduce((a, s) => a + s.data.length, 0);
  const mdatHeader = Uint8Array.from([...u32(dataLen + 8), ...fourcc('mdat')]);
  return new Blob([ftyp, head, mdatHeader, ...samples.map((s) => s.data)], { type: 'video/mp4' });
}
