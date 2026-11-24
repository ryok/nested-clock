// 曲の木の配置の検査: 兄弟が交わらない／子が親の内側／GPU の根グリッドと総当たりが一致
import { readFileSync } from 'node:fs';
import { syntheticSong, songToTree, scoreToTree, packTree, flattenTree } from './songtree.js';
// node test-songtree.mjs           → score.json（本番の曲）
// node test-songtree.mjs synthetic → 試作1の仮の曲
import { buildRootGrid, CELLS } from './layout.js';
const t0 = performance.now();
const synthetic = process.argv[2] === 'synthetic';
const song = synthetic ? syntheticSong() : JSON.parse(readFileSync(new URL('./score.json', import.meta.url)));
const tree = packTree(synthetic ? songToTree(song) : scoreToTree(song));
const lay = flattenTree(tree, { palette: [['#1f4e79', 1]], trackColors: song.tracks.map((t) => t.color) });
const ms = performance.now() - t0;
const c = (i) => [lay.center[i * 3], lay.center[i * 3 + 1], lay.center[i * 3 + 2]];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
let badKid = 0, badSib = 0, badOrder = 0;
for (let i = 0; i < lay.n; i++) { const p = lay.parent[i]; if (p >= 0) { if (p >= i) badOrder++; if (!(ang(c(i), c(p)) + lay.th[i] < lay.th[p])) badKid++; } }
const groups = [[0, lay.rootCount]];
for (let i = 0; i < lay.n; i++) if (lay.kidCount[i]) groups.push([lay.kidStart[i], lay.kidCount[i]]);
for (const [s, k] of groups) for (let a = s; a < s + k; a++) for (let b = a + 1; b < s + k; b++) if (ang(c(a), c(b)) <= lay.th[a] + lay.th[b]) badSib++;
const kinds = [0, 0, 0, 0]; const thr = [[9, 0], [9, 0], [9, 0], [9, 0]];
for (let i = 0; i < lay.n; i++) { kinds[lay.kind[i]]++; thr[lay.kind[i]][0] = Math.min(thr[lay.kind[i]][0], lay.th[i]); thr[lay.kind[i]][1] = Math.max(thr[lay.kind[i]][1], lay.th[i]); }
const g = buildRootGrid(lay);
let badGrid = 0;
for (let t = 0; t < 20000; t++) {
  const z = 2 * Math.random() - 1, ph = 2 * Math.PI * Math.random(), r = Math.sqrt(1 - z * z);
  const p = [r * Math.cos(ph), z, r * Math.sin(ph)];
  let brute = -1; for (let i = 0; i < lay.rootCount; i++) if (ang(p, c(i)) < lay.th[i]) { brute = i; break; }
  const lat = Math.asin(p[1]), az = Math.atan2(p[2], p[0]); let found = -1;
  for (let lv = 0; lv < 3 && found < 0; lv++) { const [nlat, naz, off] = g.params[lv], cs = CELLS[lv]; const i = Math.min(nlat - 1, Math.floor((lat + Math.PI / 2) / cs)); const j = Math.min(naz - 1, Math.floor((az + Math.PI) / cs)); const ci = off + i * naz + j; for (let k = g.cells[ci * 2]; k < g.cells[ci * 2] + g.cells[ci * 2 + 1]; k++) { const rr = g.items[k]; if (ang(p, c(rr)) < lay.th[rr]) { found = rr; break; } } }
  if (found < 0) for (let k = g.tail[0]; k < g.tail[0] + g.tail[1]; k++) { const rr = g.items[k]; if (ang(p, c(rr)) < lay.th[rr]) { found = rr; break; } }
  if (found !== brute) badGrid++;
}
console.log(`n=${lay.n} notes=${song.notes.length} build=${ms.toFixed(0)}ms kinds(section,bar,beat,note)=${kinds} th(min..max)=${thr.map(([a, b]) => a.toFixed(3) + '..' + b.toFixed(3)).join(' | ')}`);
const hist = {}; for (let i = 0; i < lay.n; i++) { const b = Math.floor(Math.log2(lay.th[i])); hist[b] = (hist[b] || 0) + 1; }
console.log('th histogram (log2 rad):', Object.keys(hist).sort((a, b) => a - b).map((b) => `2^${b}:${hist[b]}`).join(' '));
console.log(`badSib=${badSib} badKid=${badKid} badOrder=${badOrder} badGrid=${badGrid}/20000`);
process.exit(badSib + badKid + badOrder + badGrid ? 1 : 0);
