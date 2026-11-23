// レイアウトの検査: 兄弟どうしが交わらない／子が親の内側／根グリッドの探索が総当たりと一致
import { buildLayout, buildRootGrid, CELLS } from './layout.js';

const OCEAN = [['#1f4e79', 3], ['#2e86ab', 3], ['#58b4c9', 2.5], ['#a8dadc', 2], ['#f1faee', 1.2], ['#0b2545', 1.5], ['#264653', 1.5], ['#e76f51', 1], ['#f4a261', 0.8]];
let fail = 0;
for (const [name, cfg] of [['inner', { thMin: 0.006, thMax: 0.62 }], ['outer', { thMin: 0.004, thMax: 0.4 }]]) {
  const t0 = performance.now();
  const lay = buildLayout({ ...cfg, palette: OCEAN, seed: 7 });
  const ms = performance.now() - t0;
  const c = (i) => [lay.center[i * 3], lay.center[i * 3 + 1], lay.center[i * 3 + 2]];
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  let depthMax = 0, badSib = 0, badKid = 0, badOrder = 0;
  const depth = new Int32Array(lay.n);
  for (let i = 0; i < lay.n; i++) {
    const p = lay.parent[i];
    if (p >= 0) {
      depth[i] = depth[p] + 1;
      if (p >= i) badOrder++;
      if (!(ang(c(i), c(p)) + lay.th[i] < lay.th[p])) badKid++;
    }
    depthMax = Math.max(depthMax, depth[i]);
  }
  // 兄弟: 根どうしと、各親の子どうし
  const groups = [[0, lay.rootCount]];
  for (let i = 0; i < lay.n; i++) if (lay.kidCount[i]) groups.push([lay.kidStart[i], lay.kidCount[i]]);
  for (const [s, k] of groups) {
    for (let a = s; a < s + k; a++) for (let b = a + 1; b < s + k; b++) {
      if (ang(c(a), c(b)) <= lay.th[a] + lay.th[b]) badSib++;
    }
  }
  // 根グリッド: ランダムな点で総当たりと比較
  const g = buildRootGrid(lay);
  let badGrid = 0;
  for (let t = 0; t < 20000; t++) {
    const z = 2 * Math.random() - 1, ph = 2 * Math.PI * Math.random(), r = Math.sqrt(1 - z * z);
    const p = [r * Math.cos(ph), z, r * Math.sin(ph)];
    let brute = -1;
    for (let i = 0; i < lay.rootCount; i++) if (ang(p, c(i)) < lay.th[i]) { brute = i; break; }
    const lat = Math.asin(p[1]), az = Math.atan2(p[2], p[0]);
    let found = -1;
    for (let lv = 0; lv < 3 && found < 0; lv++) {
      const [nlat, naz, off] = g.params[lv], cs = CELLS[lv];
      const i = Math.min(nlat - 1, Math.floor((lat + Math.PI / 2) / cs));
      const j = Math.floor((az + Math.PI) / cs) % naz;
      const ci = off + i * naz + j;
      for (let k = g.cells[ci * 2]; k < g.cells[ci * 2] + g.cells[ci * 2 + 1]; k++) {
        const rr = g.items[k];
        if (ang(p, c(rr)) < lay.th[rr]) { found = rr; break; }
      }
    }
    if (found < 0) for (let k = g.tail[0]; k < g.tail[0] + g.tail[1]; k++) { const rr = g.items[k]; if (ang(p, c(rr)) < lay.th[rr]) { found = rr; break; } }
    if (found !== brute) badGrid++;
  }
  console.log(`${name}: n=${lay.n} roots=${lay.rootCount} depthMax=${depthMax} build=${ms.toFixed(0)}ms badSib=${badSib} badKid=${badKid} badOrder=${badOrder} badGrid=${badGrid}/20000 items=${g.items.length}`);
  fail += badSib + badKid + badOrder + badGrid;
}
process.exit(fail ? 1 : 0);
