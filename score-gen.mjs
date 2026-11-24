// この作品のための曲「入れ子の時計」の楽譜を作る（決定的。seed が同じなら同じ曲）。
// 出力 score.json が唯一の正: Live への打ち込みも、映像の配置も、ここから作る。
//
// 曲の考え方: 4拍子のドラムの上で、7拍（ベース）・5拍（マリンバ）・3拍（プラック）の
// ループが、和音が変わるたびにそろって始まり、少しずつずれていく（和音ごとに歯車を
// 合わせ直す）。ループは和音の終わりで切れる（最後の周期が短くなる）。和音の長さも 2〜16 拍でばらばら。
//
// 木: 曲 → セクション → 和音 → 周期（各ループの1回り・ドラムの1小節）＋パッドの音 → 小分け（7=2+2+3 など）→ 音
// 各ノートと各グループは親を明示する（時間から推測しない）。
//
// 使い方: node score-gen.mjs [seed] > score.json
import { mulberry32 } from './layout.js';

const seed = Number(process.argv[2]) || 7;
const rand = mulberry32(seed);
const pick = (a) => a[Math.floor(rand() * a.length)];
const Q = (x) => Math.round(x * 8) / 8; // 32分音符（0.125 拍）の格子

const BPM = 84;
const SECTIONS = [
  { name: 'dawn', dur: 24, layers: { pad: 1, mallet: 0.5 } },
  { name: 'gears', dur: 40, layers: { pad: 1, mallet: 0.8, bass: 0.8, drums: 0.4 } },
  { name: 'lattice', dur: 32, layers: { pad: 0.8, mallet: 0.9, bass: 0.9, drums: 0.7, pluck: 0.6 } },
  { name: 'mesh', dur: 56, layers: { pad: 0.8, mallet: 1, bass: 1, drums: 1, pluck: 1, bell: 0.6 } },
  { name: 'thaw', dur: 20, layers: { pad: 1, mallet: 0.6, bell: 0.8 } },
  { name: 'still', dur: 16, layers: { pad: 1, bell: 0.5 } },
];
const TRACKS = [
  { key: 'pad', name: 'Pad', color: '#3a6ea5', uri: 'query:Sounds#Pad:FileId_189432' }, // Analog Soft Pad
  { key: 'bass', name: 'Bass 7', color: '#2a9d8f', uri: 'query:Sounds#Bass:FileId_189621', cycle: 7, sub: [2, 2, 3] }, // Amber Low Glow
  { key: 'mallet', name: 'Marimba 5', color: '#e9c46a', uri: 'query:Sounds#Mallets:FileId_188342', cycle: 5, sub: [3, 2] }, // Basic Bright Marimba
  { key: 'pluck', name: 'Pluck 3', color: '#f4a261', uri: 'query:Sounds#Synth%20Keys:FileId_188027', cycle: 3, sub: [1.5, 1.5] }, // Basic Pluck Keys
  { key: 'drums', name: 'Drums 4', color: '#e76f51', uri: 'query:Drums#FileId_188733', cycle: 4, sub: [2, 2] }, // 606 Core Kit
  { key: 'bell', name: 'Bell', color: '#e0c3fc', uri: 'query:Sounds#Mallets:FileId_188344' }, // Basic FM Bells
];
const T = Object.fromEntries(TRACKS.map((t, i) => [t.key, i]));
// ドラムラックの音程（606 Core Kit を読み込んだあとに確認して合わせる）
const DRUM = { kick: 36, snare: 38, rim: 37, hat: 42, open: 46 };

// D ドリアン。和音は根音と構成音（MIDI）
const CHORDS = [
  { name: 'Dm9', root: 38, tones: [50, 53, 57, 60, 64] },
  { name: 'G9', root: 43, tones: [47, 50, 53, 57, 59] },
  { name: 'Cmaj7', root: 36, tones: [48, 52, 55, 59] },
  { name: 'Am7', root: 45, tones: [48, 52, 55, 57] },
  { name: 'Fmaj7', root: 41, tones: [48, 53, 57, 60, 64] },
  { name: 'Em7', root: 40, tones: [47, 50, 52, 55] },
];
const SCALE = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];

const groups = []; // { id, parent, kind, track, start, dur, name? }
const notes = []; // { track, pitch, start, dur, vel, parent }
let gid = 0;
const group = (parent, kind, track, start, dur, extra = {}) => {
  const g = { id: `g${gid++}`, parent, kind, track, start, dur, ...extra };
  groups.push(g);
  return g.id;
};
const note = (parent, track, pitch, start, dur, vel) =>
  notes.push({ track, pitch, start: Q(start), dur: Q(dur), vel: Math.max(1, Math.min(127, Math.round(vel))), parent });

// 和音の長さの並び（拍）。セクションの長さにちょうど合わせる
function chordPlan(len) {
  const out = [];
  let left = len;
  while (left > 0) {
    const opts = [2, 4, 6, 8, 10, 12, 14, 16].filter((d) => d <= left && (left - d === 0 || left - d >= 2));
    const d = opts.length ? pick(opts) : left;
    out.push(d);
    left -= d;
  }
  return out;
}

let t0 = 0;
let chordIx = 0;
const chordAt = []; // [start, end, chord]
for (const [si, sec] of SECTIONS.entries()) {
  const sid = `s${si}`;
  sec.id = sid;
  sec.start = t0;
  const L = sec.layers;
  const end = t0 + sec.dur;

  // 和音: セクションを長さのばらばらな和音に分ける。和音が木の1段になる
  const plan = [];
  {
    let t = t0;
    for (const d of chordPlan(sec.dur)) {
      const ch = CHORDS[chordIx++ % CHORDS.length];
      chordAt.push([t, t + d, ch]);
      plan.push({ t, d, ch, id: group(sid, 'chord', T.pad, t, d, { name: ch.name }) });
      t += d;
    }
  }
  const chord = (t) => chordAt.find(([a, b]) => t >= a && t < b)[2];
  // パッド: 構成音が少しずつ遅れて入り、長さがそろわない
  if (L.pad) for (const { t, d, ch, id } of plan) {
    if (rand() > L.pad) continue;
    ch.tones.forEach((p, k) => {
      const lag = k === 0 ? 0 : Q(rand() * Math.min(2, d / 3));
      const cut = Q(rand() * Math.min(1.5, d / 4));
      if (d - lag - cut >= 0.25) note(id, T.pad, p, t + lag, d - lag - cut, 52 + rand() * 20);
    });
  }

  // ループ: 和音の頭から周期を並べ、最後の周期は和音の終わりで切る
  function cycles(key, fill) {
    const tr = TRACKS[T[key]];
    for (const { t: from, d: len, id: parent } of plan) for (let c = from; c < from + len - 1e-9; c += tr.cycle) {
      const cdur = Math.min(tr.cycle, from + len - c);
      if (rand() > L[key]) continue; // このセクションでは鳴らさない周期
      const cg = group(parent, 'cycle', T[key], c, cdur);
      let s = c;
      for (const [k, sd] of tr.sub.entries()) {
        const sdur = Math.min(sd, c + cdur - s);
        if (sdur <= 1e-9) break;
        const sg = group(cg, 'sub', T[key], s, sdur);
        fill(sg, s, sdur, k, cdur < tr.cycle);
        s += sd;
      }
    }
  }

  if (L.bass) cycles('bass', (g, s, d, k) => {
    const r = chord(s).root;
    if (k === 0) { note(g, T.bass, r, s, Math.min(1.5, d), 96); if (d > 1.5) note(g, T.bass, r + 7, s + 1.5, Math.min(0.5, d - 1.5), 74); }
    else if (k === 1) { note(g, T.bass, r + 12, s, Math.min(0.5, d), 80); if (d > 0.75) note(g, T.bass, r, s + 0.75, Math.min(1, d - 0.75), 88); }
    else { note(g, T.bass, r, s, Math.min(2.5, d), 100); if (d > 2.5) note(g, T.bass, r - 2 + 12 * 0, s + 2.5, Math.min(0.5, d - 2.5), 70); }
  });

  // マリンバの 5 拍モチーフ（3+2）。拍子とずれて聞こえる
  const MOTIF = [[0, 0.5, 4], [0.5, 0.25, 6], [0.75, 0.25, 7], [1, 0.75, 5], [2, 0.25, 4], [2.25, 0.25, 2], [2.5, 0.5, 1], [0, 1, 7], [1, 0.5, 9], [1.5, 0.25, 8], [1.75, 0.25, 7]];
  if (L.mallet) cycles('mallet', (g, s, d, k) => {
    const part = k === 0 ? MOTIF.slice(0, 7) : MOTIF.slice(7);
    const shift = chord(s).root % 2; // 和音で少しだけ音を変える
    for (const [o, len, deg] of part) {
      if (o >= d - 1e-9) continue;
      if (rand() > 0.35 + 0.65 * L.mallet) continue;
      note(g, T.mallet, SCALE[Math.min(SCALE.length - 1, deg + shift)], s + o, Math.min(len, d - o), 70 + rand() * 30);
    }
  });

  // プラック 3 拍（1.5+1.5）: 16分と 32分の刻み、和音の構成音を上に
  if (L.pluck) cycles('pluck', (g, s, d) => {
    const tones = chord(s).tones.map((p) => p + 12);
    let o = 0, i = 0;
    while (o < d - 1e-9) {
      const len = rand() < 0.25 ? 0.125 : rand() < 0.7 ? 0.25 : 0.5;
      if (o + len > d + 1e-9) break;
      if (rand() < 0.75) note(g, T.pluck, tones[i++ % tones.length], s + o, len, 58 + rand() * 40);
      o += len;
    }
  });

  // ドラム: 4 拍の小節（2+2）。ハットは 16 分、mesh では 32 分のロール
  if (L.drums) cycles('drums', (g, s, d, k) => {
    const dense = L.drums;
    if (k === 0) { note(g, T.drums, DRUM.kick, s, 0.25, 110); if (rand() < 0.5 * dense && d > 1) note(g, T.drums, DRUM.rim, s + 1, 0.25, 84); }
    else { if (rand() < dense) note(g, T.drums, DRUM.snare, s, 0.25, 96); if (rand() < 0.6 && d > 0.75) note(g, T.drums, DRUM.kick, s + 0.75, 0.25, 92); }
    for (let h = 0; h < d - 1e-9; h += 0.25) {
      if (k === 0 && h === 0) continue;
      if (rand() > 0.3 + 0.6 * dense) continue;
      const roll = sec.name === 'mesh' && k === 1 && h >= 1.5 && rand() < 0.5;
      if (roll) { note(g, T.drums, DRUM.hat, s + h, 0.125, 60); note(g, T.drums, DRUM.hat, s + h + 0.125, 0.125, 72); }
      else note(g, T.drums, rand() < 0.08 ? DRUM.open : DRUM.hat, s + h, 0.25, 50 + rand() * 40);
    }
  });

  // ベル: 長い音をまばらに（セクションの直下）
  if (L.bell) {
    let t = t0 + Q(rand() * 3);
    while (t < end - 2) {
      const d = Math.min(end - t, 2 + Math.floor(rand() * 5));
      const home = plan.find((c) => t >= c.t && t + d <= c.t + c.d);
      if (rand() < L.bell) note(home ? home.id : sid, T.bell, pick(SCALE) + 12, t, d, 50 + rand() * 30);
      t += d + Q(1 + rand() * 4);
    }
  }
  t0 = end;
}

// ---- 検査: 子は親の時間の内側、同じ音程の重なりなし ----
const span = new Map(SECTIONS.map((s) => [s.id, s]));
for (const g of groups) span.set(g.id, g);
const inside = (x, p) => x.start >= p.start - 1e-9 && x.start + x.dur <= p.start + p.dur + 1e-9;
for (const x of [...groups, ...notes]) {
  const p = span.get(x.parent);
  if (!p) throw new Error(`no parent ${x.parent}`);
  if (!(x.dur > 0) || !inside(x, p)) throw new Error(`outside parent: ${JSON.stringify(x)} in ${JSON.stringify({ start: p.start, dur: p.dur })}`);
}
const byKey = new Map();
for (const n of notes) { const k = `${n.track}:${n.pitch}`; (byKey.get(k) || byKey.set(k, []).get(k)).push(n); }
for (const [k, a] of byKey) {
  a.sort((x, y) => x.start - y.start);
  for (let i = 1; i < a.length; i++) if (a[i].start < a[i - 1].start + a[i - 1].dur - 1e-9) throw new Error(`overlap ${k} at ${a[i].start}`);
}

const total = t0;
const score = {
  title: 'nested clock', bpm: BPM, beatsPerBar: 4, beats: total, tail: 8, seed,
  sections: SECTIONS.map(({ id, name, start, dur }) => ({ id, name, start, dur })),
  tracks: TRACKS.map(({ key, name, color, uri, cycle, sub }) => ({ key, name, color, uri, cycle: cycle ?? null, sub: sub ?? null })),
  drumMap: DRUM,
  groups,
  notes,
};
process.stdout.write(JSON.stringify(score));
const per = TRACKS.map((t, i) => `${t.key}=${notes.filter((n) => n.track === i).length}`).join(' ');
process.stderr.write(`beats=${total} (${((total * 60) / BPM).toFixed(1)}s) groups=${groups.length} notes=${notes.length} [${per}]\n`);
