// 曲の構造（セクション → 小節 → 拍 → ノート）を入れ子の円にする。
// 円の大きさは、兄弟のあいだで「長さの平方根」（面積が長さに比例）。
// 子は親の円の内側に、兄弟どうしは交わらないように、乱数で詰める（大きい順、入らなければ縮める）。
import { mulberry32, hexToRgb } from './layout.js';

const MARGIN = 0.0025;
const EXP = 0.55; // 円の角半径 ∝ 長さ^EXP（0.5 なら面積が長さに比例。小さい音が消えないよう少し下げる）

// ---- 仮の曲（音なし）。本番は score.json に置き換える ----
// 時間の単位は拍（beat）。ノートは自分の長さが収まる一番小さい単位の子になる
export function syntheticSong(seed = 3) {
  const rand = mulberry32(seed);
  const sections = [['intro', 8], ['verse', 16], ['hook', 8], ['verse2', 16], ['hook2', 8], ['outro', 4]];
  const tracks = [
    { name: 'kick', color: '#e76f51' }, { name: 'snare', color: '#f1faee' }, { name: 'hat', color: '#a8dadc' },
    { name: 'bass', color: '#2e86ab' }, { name: 'chord', color: '#f4a261' }, { name: 'lead', color: '#58b4c9' },
  ];
  const notes = [];
  let bar0 = 0;
  for (const [name, bars] of sections) {
    const dense = name.startsWith('hook') ? 1 : name === 'intro' || name === 'outro' ? 0.35 : 0.7;
    for (let b = bar0; b < bar0 + bars; b++) {
      const t0 = b * 4;
      if (rand() < 0.9) notes.push({ track: 0, start: t0, dur: 0.5 });
      if (rand() < dense) notes.push({ track: 0, start: t0 + 2.5, dur: 0.5 });
      if (rand() < dense) notes.push({ track: 1, start: t0 + 1, dur: 0.5 }), notes.push({ track: 1, start: t0 + 3, dur: 0.5 });
      for (let h = 0; h < 8; h++) if (rand() < dense * 0.8) notes.push({ track: 2, start: t0 + h * 0.5, dur: 0.25 });
      if (rand() < dense) notes.push({ track: 3, start: t0, dur: 1.5 }), notes.push({ track: 3, start: t0 + 2, dur: 1 });
      if (b % 2 === 0) notes.push({ track: 4, start: t0, dur: 8 }); // 2小節のコード
      else if (rand() < dense * 0.6) notes.push({ track: 4, start: t0 + 2, dur: 2 });
      if (rand() < dense * 0.5) notes.push({ track: 5, start: t0 + Math.floor(rand() * 8) * 0.5, dur: 0.5 + Math.floor(rand() * 3) * 0.5 });
    }
    bar0 += bars;
  }
  return { bpm: 88, sections: sections.map(([name, bars]) => ({ name, bars })), tracks, notes };
}

// 曲 → 木。各ノードは { kind, start, dur, kids, track? }
export function songToTree(song) {
  const sections = [];
  let beat = 0;
  for (const s of song.sections) {
    const sec = { kind: 'section', name: s.name, start: beat, dur: s.bars * 4, kids: [] };
    for (let b = 0; b < s.bars; b++) {
      const bar = { kind: 'bar', start: beat + b * 4, dur: 4, kids: [] };
      for (let k = 0; k < 4; k++) bar.kids.push({ kind: 'beat', start: bar.start + k, dur: 1, kids: [] });
      sec.kids.push(bar);
    }
    sections.push(sec);
    beat += s.bars * 4;
  }
  // ノートを、自分の長さが収まる一番深いノードに入れる
  for (const n of song.notes) {
    const end = n.start + n.dur;
    const fits = (x) => x.start <= n.start + 1e-9 && end <= x.start + x.dur + 1e-9;
    let parent = sections.find(fits);
    if (!parent) continue; // セクションをまたぐノートは今は捨てる
    for (;;) {
      const next = parent.kids.find((k) => k.kind !== 'note' && fits(k));
      if (!next) break;
      parent = next;
    }
    parent.kids.push({ kind: 'note', track: n.track, start: n.start, dur: n.dur, kids: [] });
  }
  return { kind: 'song', start: 0, dur: beat, kids: sections };
}

// score.json → 木。親子は楽譜に書かれたとおり（時間から推測しない）
export function scoreToTree(score) {
  const nodes = new Map();
  const sections = score.sections.map((s) => {
    const x = { kind: 'section', name: s.name, start: s.start, dur: s.dur, kids: [] };
    nodes.set(s.id, x);
    return x;
  });
  for (const g of score.groups) {
    const x = { kind: g.kind, track: g.track, start: g.start, dur: g.dur, kids: [] };
    nodes.set(g.id, x);
    const p = nodes.get(g.parent);
    if (!p) throw new Error(`group ${g.id}: parent ${g.parent} not found (parents must come first)`);
    p.kids.push(x);
  }
  for (const n of score.notes) {
    const p = nodes.get(n.parent);
    if (!p) throw new Error(`note parent ${n.parent} not found`);
    if (n.start < p.start - 1e-9 || n.start + n.dur > p.start + p.dur + 1e-9) throw new Error(`note outside parent: ${JSON.stringify(n)}`);
    p.kids.push({ kind: 'note', track: n.track, pitch: n.pitch, vel: n.vel, start: n.start, dur: n.dur, kids: [] });
  }
  return { kind: 'song', start: 0, dur: score.beats, kids: sections };
}

// ---- 球面の幾何 ----
function randomInCap(rand, c, R) {
  // 中心 c・角半径 R の球冠の中で一様な点
  const cosR = Math.cos(R);
  const z = 1 - rand() * (1 - cosR);
  const phi = 2 * Math.PI * rand();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  // c を z 軸とする正規直交基底
  const a = Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
  const ul = Math.hypot(...u); u = u.map((x) => x / ul);
  const v = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]];
  const x = r * Math.cos(phi), y = r * Math.sin(phi);
  return [0, 1, 2].map((i) => x * u[i] + y * v[i] + z * c[i]);
}
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// 親の球冠（中心 c、半径 R。根は球全体 R=π）に子を詰める
function packKids(rand, kids, c, R, fill, exp = EXP) {
  if (!kids.length) return;
  const w = kids.map((k) => Math.pow(k.dur, exp));
  const parentArea = 2 * Math.PI * (1 - Math.cos(R));
  // 小さい角半径では球冠の面積 ≈ π th²。全体で親の面積の fill 割を目安に始める
  let s = Math.sqrt((fill * parentArea) / (Math.PI * w.reduce((a, x) => a + x * x, 0)));
  const order = kids.map((_, i) => i).sort((a, b) => w[b] - w[a]);
  for (let attempt = 0; attempt < 200; attempt++, s *= 0.96) {
    const placed = [];
    let ok = true;
    for (const i of order) {
      const th = s * w[i];
      const room = R >= Math.PI ? Math.PI : R - th - MARGIN;
      if (room < 0) { ok = false; break; }
      let done = false;
      for (let t = 0; t < 600; t++) {
        const p = R >= Math.PI ? randomInCap(rand, [0, 0, 1], Math.PI) : randomInCap(rand, c, room);
        if (placed.every((q) => ang(p, q.c) > th + q.th + MARGIN)) {
          placed.push({ i, c: p, th });
          done = true;
          break;
        }
      }
      if (!done) { ok = false; break; }
    }
    if (ok) {
      for (const q of placed) { kids[q.i].c = q.c; kids[q.i].th = q.th; }
      return;
    }
  }
  throw new Error(`packKids failed: ${kids.length} kids in R=${R}`);
}

export function packTree(tree, { seed = 1, exp = EXP, scale = 1.4, fill = { song: 0.6, section: 0.55, bar: 0.5, beat: 0.45, cycle: 0.55, chord: 0.5, sub: 0.55 } } = {}) {
  const rand = mulberry32(seed);
  const walk = (node, c, R) => {
    packKids(rand, node.kids, c, R, Math.min(0.9, (fill[node.kind] ?? 0.45) * scale), exp);
    for (const k of node.kids) walk(k, k.c, k.th);
  };
  walk(tree, [0, 0, 1], Math.PI);
  return tree;
}

// 木 → レンダラー用の配列（layout.js の buildLayout と同じ形＋時間）
export function flattenTree(tree, { palette, trackColors }) {
  const order = [...tree.kids];
  const parentOf = new Map(tree.kids.map((k) => [k, -1]));
  for (let h = 0; h < order.length; h++) for (const k of order[h].kids) { parentOf.set(k, h); order.push(k); }
  const index = new Map(order.map((x, i) => [x, i]));
  const n = order.length;
  const out = {
    n, rootCount: tree.kids.length,
    center: new Float32Array(n * 3), th: new Float32Array(n), parent: new Int32Array(n),
    kidStart: new Uint32Array(n), kidCount: new Uint32Array(n), color: new Float32Array(n * 3),
    start: new Float32Array(n), dur: new Float32Array(n), kind: new Uint8Array(n), track: new Int8Array(n).fill(-1),
    omega: new Float32Array(n),
  };
  // 0=セクション 1=周期（ループの1回り・和音・小節）2=小分け 3=音
  const KIND = { section: 0, bar: 1, cycle: 1, chord: 1, beat: 2, sub: 2, note: 3 };
  const rand = mulberry32(99);
  const total = palette.reduce((a, [, w]) => a + w, 0);
  order.forEach((x, i) => {
    out.center.set(x.c, i * 3);
    out.th[i] = x.th;
    out.parent[i] = parentOf.get(x);
    out.kidCount[i] = x.kids.length;
    out.kidStart[i] = x.kids.length ? index.get(x.kids[0]) : 0;
    out.start[i] = x.start; out.dur[i] = x.dur; out.kind[i] = KIND[x.kind];
    if (x.track != null) out.track[i] = x.track;
    let hex;
    if (x.kind === 'note') { out.track[i] = x.track; hex = trackColors[x.track]; }
    else if (x.track != null && trackColors[x.track] && x.kind !== 'section') {
      // 周期・小分けは、その楽器の色を暗くしたもの
      const [r, g, b] = hexToRgb(trackColors[x.track]);
      const k = x.kind === 'sub' ? 0.32 : 0.2;
      out.color.set([r * k, g * k, b * k], i * 3);
      return;
    }
    else {
      let r = rand() * total;
      hex = palette.find(([, w]) => (r -= w) <= 0)?.[0] ?? palette[0][0];
    }
    out.color.set(hexToRgb(hex), i * 3);
  });
  return out;
}
