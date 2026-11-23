// 球面上に、入れ子になった交わらない円（球冠）を敷き詰める。CPU で1回だけ作る。
// 仕様: https://gist.github.com/tzador/8a2f609d4c97daf4e30adb382d30ddac

export const CELLS = [0.03, 0.12, 0.48];
const MARGIN = 0.0025;
const ALPHA = 2.1;
const MAX_CIRCLES = 16384;
const GRID_AFTER = 48;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelOf(th) {
  for (let l = 0; l < 3; l++) if (CELLS[l] >= th) return l;
  return 3; // 0.48 より大きい円は線形リスト
}

const HALF_PI = Math.PI / 2;

function latAz(x, y, z) {
  return [Math.asin(Math.max(-1, Math.min(1, y))), Math.atan2(z, x)];
}

// 中心 (lat, az)・角半径 R の球冠が触れる（緯度帯 i, 経度 j）のセルを列挙する
export function forCellsInCap(lat, az, R, cs, nlat, naz, fn) {
  const i0 = Math.max(0, Math.floor((lat - R + HALF_PI) / cs));
  const i1 = Math.min(nlat - 1, Math.floor((lat + R + HALF_PI) / cs));
  // 経度は角度のまま区間にしてから、0〜2π で折り返して区間を分ける。
  // naz*cs は 2π と一致しないので、セル番号のほうを mod naz で折り返すとずれる
  const TWO_PI = 2 * Math.PI;
  const cellJ = (a) => Math.min(naz - 1, Math.floor(a / cs));
  const ranges = [];
  if (Math.abs(lat) + R >= HALF_PI) ranges.push([0, naz - 1]);
  else {
    const half = Math.asin(Math.min(1, Math.sin(R) / Math.cos(lat)));
    const lo = az - half + Math.PI, hi = az + half + Math.PI;
    if (hi - lo >= TWO_PI) ranges.push([0, naz - 1]);
    else if (lo < 0) { ranges.push([0, cellJ(hi)], [cellJ(lo + TWO_PI), naz - 1]); }
    else if (hi >= TWO_PI) { ranges.push([cellJ(lo), naz - 1], [0, cellJ(hi - TWO_PI)]); }
    else ranges.push([cellJ(lo), cellJ(hi)]);
  }
  for (let i = i0; i <= i1; i++) {
    for (const [j0, j1] of ranges) {
      for (let j = j0; j <= j1; j++) if (fn(i * naz + j, i, j)) return true;
    }
  }
  return false;
}

// 兄弟リスト用の球面グリッド（3段のセル＋大きい円の線形リスト）
class SiblingGrid {
  constructor(L) {
    this.L = L;
    this.levels = CELLS.map((cs) => {
      const nlat = Math.ceil(Math.PI / cs), naz = Math.ceil((2 * Math.PI) / cs);
      return { cs, nlat, naz, cells: new Map() };
    });
    this.tail = [];
  }
  key(id) {
    const L = this.L, lv = levelOf(L.th[id]);
    if (lv === 3) return [3, -1];
    const g = this.levels[lv];
    const [lat, az] = latAz(L.cx[id], L.cy[id], L.cz[id]);
    const i = Math.min(g.nlat - 1, Math.floor((lat + HALF_PI) / g.cs));
    const j = ((Math.floor((az + Math.PI) / g.cs) % g.naz) + g.naz) % g.naz;
    return [lv, i * g.naz + j];
  }
  insert(id) {
    const [lv, k] = this.key(id);
    if (lv === 3) { this.tail.push(id); return; }
    const cells = this.levels[lv].cells;
    let a = cells.get(k);
    if (!a) cells.set(k, (a = []));
    a.push(id);
  }
  remove(id) {
    const [lv, k] = this.key(id);
    const a = lv === 3 ? this.tail : this.levels[lv].cells.get(k);
    const p = a.indexOf(id);
    if (p >= 0) a.splice(p, 1);
  }
  // visit(id) が true を返したら打ち切る
  query(x, y, z, th, visit) {
    const [lat, az] = latAz(x, y, z);
    for (const g of this.levels) {
      const R = th + g.cs + 0.01;
      const stop = forCellsInCap(lat, az, R, g.cs, g.nlat, g.naz, (k) => {
        const a = g.cells.get(k);
        if (a) for (let n = 0; n < a.length; n++) if (visit(a[n])) return true;
        return false;
      });
      if (stop) return;
    }
    for (let n = 0; n < this.tail.length; n++) if (visit(this.tail[n])) return;
  }
}

function makeContainer() {
  return { kids: [], grid: null };
}

function addKid(L, cont, id) {
  cont.kids.push(id);
  if (cont.grid) cont.grid.insert(id);
  else if (cont.kids.length > GRID_AFTER) {
    cont.grid = new SiblingGrid(L);
    for (const k of cont.kids) cont.grid.insert(k);
  }
}

function removeKid(cont, id) {
  const p = cont.kids.indexOf(id);
  if (p >= 0) cont.kids.splice(p, 1);
  if (cont.grid) cont.grid.remove(id);
}

function pickColor(palette, total, r) {
  let x = r * total;
  for (const [hex, w] of palette) {
    if ((x -= w) <= 0) return hex;
  }
  return palette[palette.length - 1][0];
}

export function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// 戻り値: 幅優先に並べ直した円（親が子より前、子は連続）
export function buildLayout({ thMin, thMax, palette, seed = 1, samples = 12000, tries = 200 }) {
  const rand = mulberry32(seed);
  const L = {
    cx: new Float64Array(MAX_CIRCLES), cy: new Float64Array(MAX_CIRCLES), cz: new Float64Array(MAX_CIRCLES),
    th: new Float64Array(MAX_CIRCLES), parent: new Int32Array(MAX_CIRCLES).fill(-1),
    kidsOf: [], n: 0,
  };
  const root = makeContainer();
  const k = 1 - Math.pow(thMin / thMax, ALPHA - 1);

  for (let s = 0; s < samples && L.n < MAX_CIRCLES; s++) {
    const th = thMin * Math.pow(1 - rand() * k, -1 / (ALPHA - 1));
    for (let t = 0; t < tries; t++) {
      const z = 2 * rand() - 1, phi = 2 * Math.PI * rand();
      const r = Math.sqrt(1 - z * z);
      if (tryPlace(L, root, r * Math.cos(phi), z, r * Math.sin(phi), th)) break;
    }
  }

  // 幅優先で並べ直す
  const n = L.n;
  const order = [], newIndex = new Int32Array(n);
  const rootKids = root.kids.slice();
  for (const id of rootKids) order.push(id);
  for (let h = 0; h < order.length; h++) for (const c of L.kidsOf[order[h]].kids) order.push(c);
  order.forEach((id, i) => (newIndex[id] = i));

  const total = palette.reduce((a, [, w]) => a + w, 0);
  const out = {
    n, rootCount: rootKids.length,
    center: new Float32Array(n * 3), th: new Float32Array(n),
    parent: new Int32Array(n), kidStart: new Uint32Array(n), kidCount: new Uint32Array(n),
    color: new Float32Array(n * 3), omega: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const id = order[i];
    out.center.set([L.cx[id], L.cy[id], L.cz[id]], i * 3);
    out.th[i] = L.th[id];
    out.parent[i] = L.parent[id] < 0 ? -1 : newIndex[L.parent[id]];
    const kids = L.kidsOf[id].kids;
    out.kidCount[i] = kids.length;
    out.kidStart[i] = kids.length ? newIndex[kids[0]] : 0;
    out.color.set(hexToRgb(pickColor(palette, total, rand())), i * 3);
    out.omega[i] = (rand() < 0.5 ? -1 : 1) * (0.14 / L.th[id]);
  }
  return out;
}

function tryPlace(L, root, x, y, z, th) {
  let cont = root, parent = -1;
  const contains = [];
  for (;;) {
    let inside = -1, cross = false;
    contains.length = 0;
    const visit = (q) => {
      const dt = x * L.cx[q] + y * L.cy[q] + z * L.cz[q];
      const d = Math.acos(Math.max(-1, Math.min(1, dt)));
      const qt = L.th[q];
      if (d + th < qt - MARGIN) { inside = q; return true; }
      if (d + qt < th - MARGIN) { contains.push(q); return false; }
      if (d > th + qt + MARGIN) return false;
      cross = true;
      return true;
    };
    if (cont.grid) cont.grid.query(x, y, z, th, visit);
    else for (const q of cont.kids) if (visit(q)) break;
    if (cross) return false;
    if (inside >= 0) { parent = inside; cont = L.kidsOf[inside]; continue; }

    const id = L.n++;
    L.cx[id] = x; L.cy[id] = y; L.cz[id] = z; L.th[id] = th; L.parent[id] = parent;
    L.kidsOf[id] = makeContainer();
    const moved = contains.slice();
    for (const q of moved) removeKid(cont, q);
    addKid(L, cont, id);
    for (const q of moved) { L.parent[q] = id; addKid(L, L.kidsOf[id], q); }
    return true;
  }
}

// GPU 用の根の探索グリッド（3段、各セルに届きうる根を全部入れる）
export function buildRootGrid(lay) {
  const levels = CELLS.map((cs) => ({ cs, nlat: Math.ceil(Math.PI / cs), naz: Math.ceil((2 * Math.PI) / cs) }));
  const lists = levels.map((g) => Array.from({ length: g.nlat * g.naz }, () => []));
  const tail = [];
  for (let r = 0; r < lay.rootCount; r++) {
    const th = lay.th[r], lv = levelOf(th);
    if (lv === 3) { tail.push(r); continue; }
    const g = levels[lv];
    const [lat, az] = latAz(lay.center[r * 3], lay.center[r * 3 + 1], lay.center[r * 3 + 2]);
    forCellsInCap(lat, az, th + 0.012, g.cs, g.nlat, g.naz, (k) => { lists[lv][k].push(r); return false; });
  }
  const totalCells = lists.reduce((a, l) => a + l.length, 0);
  const cells = new Uint32Array(totalCells * 2);
  const items = [];
  const params = [];
  let off = 0;
  lists.forEach((l, lv) => {
    params.push([levels[lv].nlat, levels[lv].naz, off]);
    l.forEach((a, k) => {
      cells[(off + k) * 2] = items.length;
      cells[(off + k) * 2 + 1] = a.length;
      for (const r of a) items.push(r);
    });
    off += l.length;
  });
  const tailStart = items.length;
  for (const r of tail) items.push(r);
  if (items.length === 0) items.push(0);
  return { cells, items: Uint32Array.from(items), params, tail: [tailStart, tail.length] };
}
