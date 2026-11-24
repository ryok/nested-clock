// score.json を Ableton Live に打ち込み、読み戻して一致を確かめる。
//   node push-live.mjs --first 4 --slot 0 [--load] [--arrange]
//   --first   この曲の 1 本目のトラック番号（score.tracks の順に並べる）
//   --slot    Session のクリップ枠（clip add-notes は足し算なので、打ち直すときは空いた枠を使う）
//   --load    トラック名を付け、楽器を読み込む（最初の1回だけ）
//   --arrange 一致を確かめたあと、Arrangement の 0 拍目にコピーする
//   --verify  打ち込まずに、読み戻しの照合だけ行う
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes(k);
const first = Number(opt('--first', NaN));
const slot = Number(opt('--slot', 0));
if (!Number.isInteger(first)) throw new Error('--first is required');

const score = JSON.parse(readFileSync(new URL('./score.json', import.meta.url)));
const live = (...a) => execFileSync('ableton', a.map(String), { encoding: 'utf8' });
const dir = mkdtempSync(join(tmpdir(), 'score-'));

if (has('--load')) {
  live('tempo', score.bpm);
  score.tracks.forEach((t, k) => {
    live('track', 'rename', first + k, t.name);
    console.log(live('load', first + k, t.uri).trim());
  });
}

const EPS = 1e-4;
let bad = 0;
score.tracks.forEach((t, k) => {
  const ti = first + k;
  const mine = score.notes.filter((n) => n.track === k).map((n) => ({ pitch: n.pitch, start_time: n.start, duration: n.dur, velocity: n.vel, mute: false }));
  if (!has('--verify')) {
    live('clip', 'create', ti, slot, '-l', score.beats);
    live('clip', 'rename', ti, slot, `${score.title} · ${t.name}`);
    const f = join(dir, `t${k}.json`);
    writeFileSync(f, JSON.stringify(mine));
    live('clip', 'add-notes', ti, slot, '--file', f);
  }
  // 読み戻して照合（数・音程・開始・長さ・強さ）
  const raw = JSON.parse(live('clip', 'notes', ti, slot));
  const back = (Array.isArray(raw) ? raw : raw.notes).map((n) => ({ pitch: n.pitch, start_time: n.start_time, duration: n.duration, velocity: Math.round(n.velocity) }));
  const key = (n) => `${n.pitch}@${n.start_time.toFixed(4)}`;
  const want = new Map(mine.map((n) => [key(n), n]));
  let miss = 0, diff = 0;
  for (const n of back) {
    const w = want.get(key(n));
    if (!w) { miss++; continue; }
    if (Math.abs(w.duration - n.duration) > EPS || w.velocity !== n.velocity) diff++;
    want.delete(key(n));
  }
  const left = want.size;
  bad += miss + diff + left;
  console.log(`${t.name.padEnd(10)} track ${ti} slot ${slot}: score=${mine.length} live=${back.length} extra=${miss} changed=${diff} missing=${left}`);
});
if (bad) { console.error(`MISMATCH ${bad}`); process.exit(1); }
console.log('OK: Live のノートは score.json と一致');

if (has('--arrange')) {
  score.tracks.forEach((t, k) => live('clip', 'to-arrangement', first + k, slot, 0));
  console.log('Arrangement の 0 拍目にコピーした');
}
