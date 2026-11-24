// 描画シェーダー（index.html と song.html で共有）
export const FOCAL = 1.36;
export const WGSL = /* wgsl */ `
struct U {
  r0: vec4f, r1: vec4f, r2: vec4f,   // 世界→球の局所（行）。w に隙間の色
  res: vec2f, radius: f32, dim: f32,
  mode: vec4f,                        // x: 1=内側の球（外から見る）, 0=外壁（内から見る）
  g0: vec4u, g1: vec4u, g2: vec4u,    // nlat, naz, セルの先頭
  tail: vec4u,                        // 大きい根: items の先頭, 個数
};
struct Circle { w: vec4f, l: vec4f, c: vec4f };  // 世界中心+cos(th) / 局所中心+kidStart / 色+kidCount
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> circ: array<Circle>;
@group(0) @binding(2) var<storage, read> cells: array<vec2u>;
@group(0) @binding(3) var<storage, read> items: array<u32>;

const PI = 3.14159265359;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn scanCell(ci: u32, pl: vec3f) -> i32 {
  let se = cells[ci];
  for (var k = se.x; k < se.x + se.y; k++) {
    let r = items[k];
    let c = circ[r];
    if (dot(pl, c.l.xyz) > c.w.w) { return i32(r); }
  }
  return -1;
}

fn cellOf(lat: f32, az: f32, g: vec4u, cs: f32) -> u32 {
  let i = min(g.x - 1u, u32(max(0.0, floor((lat + 0.5 * PI) / cs))));
  let j = min(g.y - 1u, u32(max(0.0, floor((az + PI) / cs))));
  return g.z + i * g.y + j;
}

fn findRoot(pl: vec3f) -> i32 {
  let lat = asin(clamp(pl.y, -1.0, 1.0));
  let az = atan2(pl.z, pl.x);
  var r = scanCell(cellOf(lat, az, u.g0, 0.03), pl);
  if (r >= 0) { return r; }
  r = scanCell(cellOf(lat, az, u.g1, 0.12), pl);
  if (r >= 0) { return r; }
  r = scanCell(cellOf(lat, az, u.g2, 0.48), pl);
  if (r >= 0) { return r; }
  for (var k = u.tail.x; k < u.tail.x + u.tail.y; k++) {
    let id = items[k];
    let c = circ[id];
    if (dot(pl, c.l.xyz) > c.w.w) { return i32(id); }
  }
  return -1;
}

fn surfaceColor(pw: vec3f, pl: vec3f) -> vec3f {
  var idx = findRoot(pl);
  if (idx < 0) { return vec3f(u.r0.w, u.r1.w, u.r2.w); }
  for (var depth = 0; depth < 64; depth++) {
    let n = circ[idx];
    let ks = u32(max(n.l.w, 0.0));
    let kc = u32(max(n.c.w, 0.0));
    var found = -1;
    for (var k = ks; k < ks + kc; k++) {
      let ch = circ[k];
      if (dot(pw, ch.w.xyz) > ch.w.w) { found = i32(k); break; }
    }
    if (found < 0) { break; }
    idx = found;
  }
  // 子のない円で c.w < 0 のものは輪: l.w = 内側の穴の半径（自分の半径に対する比）、
  // c.w = -(親の番号 + 1)。穴の中は親の色を見せる（のっぺりした大きい円を避ける）
  let leaf = circ[idx];
  if (leaf.c.w < 0.0 && leaf.l.w > 0.0) {
    let th = acos(clamp(leaf.w.w, -1.0, 1.0));
    if (dot(pw, leaf.w.xyz) > cos(th * leaf.l.w)) { return circ[u32(-leaf.c.w - 1.0)].c.xyz; }
  }
  return leaf.c.xyz;
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  var uv = (fc.xy - 0.5 * u.res) / min(u.res.x, u.res.y);
  uv.y = -uv.y;
  let eye = vec3f(0.0, 0.0, 3.4);
  let rd = normalize(vec3f(uv, -${FOCAL}));
  let R = u.radius;
  let b = dot(eye, rd);
  let cc = dot(eye, eye) - R * R;
  let h = b * b - cc;
  let cov = smoothstep(0.0, 1.5 * fwidth(h), h);
  let inner = u.mode.x > 0.5;
  var t: f32;
  var alpha = 1.0;
  if (inner) {
    if (h <= 0.0 || cov <= 0.0) { discard; }
    t = -b - sqrt(h);
    alpha = cov;
  } else {
    t = -b + sqrt(max(h, 0.0));
  }
  let p = (eye + rd * t) / R;
  var n = p;
  if (!inner) { n = -p; }
  let pl = vec3f(dot(u.r0.xyz, p), dot(u.r1.xyz, p), dot(u.r2.xyz, p));
  let base = surfaceColor(p, pl);

  let L = normalize(vec3f(-0.45, 0.6, 0.7));
  let hemi = mix(vec3f(0.03, 0.03, 0.04), vec3f(0.40, 0.41, 0.44), smoothstep(-1.0, 0.7, p.y));
  var diff = 0.5 * max(dot(n, L), 0.0);
  let H = normalize(L - rd);
  var spec = pow(max(dot(n, H), 0.0), 70.0) * 0.1;
  let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.08 * hemi;
  if (!inner) {
    let P = p * 9.0;
    let pd = dot(P, L);
    if (pd < 0.0) {
      let s = mix(0.15, 1.0, smoothstep(0.7, 2.6, length(P - pd * L)));
      diff *= s;
      spec *= s;
    }
  }
  let col = (base * (hemi + diff) + spec + rim) * u.dim;
  return vec4f(col, alpha);
}
`;
