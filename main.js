import { buildLayout, buildRootGrid, hexToRgb } from './layout.js';

const OCEAN = [['#1f4e79', 3], ['#2e86ab', 3], ['#58b4c9', 2.5], ['#a8dadc', 2], ['#f1faee', 1.2], ['#0b2545', 1.5], ['#264653', 1.5], ['#e76f51', 1], ['#f4a261', 0.8]];
const DUSK = [['#2b1b4a', 3], ['#4b2c7a', 3], ['#7a4fa3', 2], ['#b48ec9', 1.5], ['#e0c3fc', 0.6], ['#1b1333', 2], ['#3d5a80', 1.5], ['#16213e', 1.5], ['#c05299', 0.8]];
const EYE = [0, 0, 3.4];
const FOCAL = 1.36;

// ---- 3x3 行列（行優先） ----
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul(a, b, o = new Array(9)) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function rotAxis(ax, ang, o = new Array(9)) {
  let [x, y, z] = ax;
  const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  o[0] = t * x * x + c;     o[1] = t * x * y - s * z; o[2] = t * x * z + s * y;
  o[3] = t * x * y + s * z; o[4] = t * y * y + c;     o[5] = t * y * z - s * x;
  o[6] = t * x * z - s * y; o[7] = t * y * z + s * x; o[8] = t * z * z + c;
  return o;
}
function orthonormalize(m) {
  // 列ベクトルを Gram-Schmidt で直交化（誤差の蓄積を防ぐ）
  const c0 = [m[0], m[3], m[6]], c1 = [m[1], m[4], m[7]];
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const a = n(c0);
  const d = a[0] * c1[0] + a[1] * c1[1] + a[2] * c1[2];
  const b = n([c1[0] - d * a[0], c1[1] - d * a[1], c1[2] - d * a[2]]);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  m[0] = a[0]; m[3] = a[1]; m[6] = a[2]; m[1] = b[0]; m[4] = b[1]; m[7] = b[2]; m[2] = c[0]; m[5] = c[1]; m[8] = c[2];
}

const WGSL = /* wgsl */ `
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
    let ks = u32(n.l.w);
    let kc = u32(n.c.w);
    var found = -1;
    for (var k = ks; k < ks + kc; k++) {
      let ch = circ[k];
      if (dot(pw, ch.w.xyz) > ch.w.w) { found = i32(k); break; }
    }
    if (found < 0) { break; }
    idx = found;
  }
  return circ[idx].c.xyz;
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

async function main() {
  const msg = document.getElementById('msg');
  const fail = () => { msg.style.display = 'flex'; };
  if (!navigator.gpu) return fail();
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return fail();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const seed = Number(new URLSearchParams(location.search).get('seed')) || 1;
  const t0 = performance.now();
  const specs = [
    { name: 'outer', thMin: 0.004, thMax: 0.4, palette: DUSK, gap: '#08060f', radius: 9, dim: 0.6, mode: 0, seed: seed * 2 + 1 },
    { name: 'inner', thMin: 0.006, thMax: 0.62, palette: OCEAN, gap: '#050a12', radius: 1, dim: 1, mode: 1, seed: seed * 2 },
  ];
  for (const s of specs) {
    s.lay = buildLayout(s);
    s.grid = buildRootGrid(s.lay);
  }
  console.log(`[circles] layout ${(performance.now() - t0).toFixed(0)}ms`, specs.map((s) => `${s.name}=${s.lay.n}`).join(' '));
  window.__circles = { counts: specs.map((s) => s.lay.n), frames: 0 };

  const module = device.createShaderModule({ code: WGSL });
  const info = await module.getCompilationInfo();
  for (const m of info.messages) console.log(`[circles] wgsl ${m.type}: ${m.message} (line ${m.lineNum})`);
  const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
  });

  const buf = (data, usage) => {
    const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  for (const s of specs) {
    const n = s.lay.n;
    s.data = new Float32Array(n * 12);
    s.W = new Float64Array(n * 9);
    s.ubuf = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    s.cbuf = device.createBuffer({ size: s.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const cellsBuf = buf(s.grid.cells, GPUBufferUsage.STORAGE);
    const itemsBuf = buf(s.grid.items, GPUBufferUsage.STORAGE);
    s.bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [s.ubuf, s.cbuf, cellsBuf, itemsBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    s.u = new ArrayBuffer(144);
    s.uf = new Float32Array(s.u);
    s.uu = new Uint32Array(s.u);
    s.gapRgb = hexToRgb(s.gap);
    s.grid.params.forEach(([nlat, naz, off], lv) => s.uu.set([nlat, naz, off, 0], 20 + lv * 4));
    s.uu.set([s.grid.tail[0], s.grid.tail[1], 0, 0], 32);
    // 色と kidStart / kidCount は固定
    const L = s.lay;
    for (let i = 0; i < n; i++) {
      const o = i * 12;
      s.data[o + 3] = Math.cos(L.th[i]);
      s.data[o + 4] = L.center[i * 3]; s.data[o + 5] = L.center[i * 3 + 1]; s.data[o + 6] = L.center[i * 3 + 2];
      s.data[o + 7] = L.kidStart[i];
      s.data[o + 8] = L.color[i * 3]; s.data[o + 9] = L.color[i * 3 + 1]; s.data[o + 10] = L.color[i * 3 + 2];
      s.data[o + 11] = L.kidCount[i];
    }
  }

  // ---- 回転の状態 ----
  let root = rotAxis([1, 0, 0], 0.25);
  let spinAxis = [0, 1, 0], spinVel = 0.12, released = false;
  let dragging = false, last = null, lastMoveT = 0, fling = null;

  function resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  // ポインタを同じカメラで単位球に投げる。外れたら一番近い輪郭の点
  function toSphere(ev) {
    const r = canvas.getBoundingClientRect();
    const m = Math.min(r.width, r.height);
    const ux = (ev.clientX - r.left - 0.5 * r.width) / m, uy = -(ev.clientY - r.top - 0.5 * r.height) / m;
    const l = Math.hypot(ux, uy, FOCAL);
    const rd = [ux / l, uy / l, -FOCAL / l];
    const b = EYE[0] * rd[0] + EYE[1] * rd[1] + EYE[2] * rd[2];
    const h = b * b - (EYE[2] * EYE[2] - 1);
    const t = h >= 0 ? -b - Math.sqrt(h) : -b;
    const p = [EYE[0] + rd[0] * t, EYE[1] + rd[1] * t, EYE[2] + rd[2] * t];
    const pl = Math.hypot(...p);
    return p.map((x) => x / pl);
  }
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    dragging = true; last = toSphere(ev); lastMoveT = performance.now(); fling = null;
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const p = toSphere(ev), now = performance.now();
    const ax = [last[1] * p[2] - last[2] * p[1], last[2] * p[0] - last[0] * p[2], last[0] * p[1] - last[1] * p[0]];
    const s = Math.hypot(...ax), c = last[0] * p[0] + last[1] * p[1] + last[2] * p[2];
    if (s > 1e-9) {
      const ang = Math.atan2(s, c);
      root = mul(rotAxis(ax, ang), root);
      const dt = Math.max(1e-3, (now - lastMoveT) / 1000);
      fling = { axis: ax.map((x) => x / s), vel: ang / dt };
      lastMoveT = now;
    }
    last = p;
  });
  const up = (ev) => {
    if (!dragging) return;
    dragging = false;
    if (performance.now() - lastMoveT > 120) fling = null;
    if (fling) { spinAxis = fling.axis; spinVel = fling.vel; } else spinVel = 0;
    released = true;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // ---- 毎フレームの回転計算（親の回転に乗りながら自分の中心まわりに回る） ----
  const tmpR = new Array(9), tmpW = new Array(9);
  function updateCircles(s, rootM, t) {
    const L = s.lay, W = s.W, D = s.data;
    for (let i = 0; i < L.n; i++) {
      const p = L.parent[i];
      const P = p < 0 ? rootM : W.subarray(p * 9, p * 9 + 9);
      const cx = L.center[i * 3], cy = L.center[i * 3 + 1], cz = L.center[i * 3 + 2];
      rotAxis([cx, cy, cz], L.omega[i] * t, tmpR);
      mul(P, tmpR, tmpW);
      W.set(tmpW, i * 9);
      const o = i * 12;
      D[o] = P[0] * cx + P[1] * cy + P[2] * cz;
      D[o + 1] = P[3] * cx + P[4] * cy + P[5] * cz;
      D[o + 2] = P[6] * cx + P[7] * cy + P[8] * cz;
    }
  }

  let prev = performance.now();
  const start = prev;
  function frame(now) {
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    const t = (now - start) / 1000;
    if (!dragging) {
      if (released) spinVel = Math.max(0.08, spinVel * Math.pow(0.15, dt));
      root = mul(rotAxis(spinAxis, spinVel * dt), root);
    }
    orthonormalize(root);
    resize();

    const roots = {
      inner: root,
      outer: mul(mul(root, rotAxis([0.6, 0, 0.8], 1.1)), rotAxis([0, 1, 0], -0.04 * t)),
    };
    for (const s of specs) {
      const R = roots[s.name];
      updateCircles(s, R, t);
      device.queue.writeBuffer(s.cbuf, 0, s.data);
      // 世界→局所 = R の転置。行 = R の列
      s.uf.set([R[0], R[3], R[6], s.gapRgb[0], R[1], R[4], R[7], s.gapRgb[1], R[2], R[5], R[8], s.gapRgb[2]], 0);
      s.uf.set([canvas.width, canvas.height, s.radius, s.dim, s.mode, 0, 0, 0], 12);
      device.queue.writeBuffer(s.ubuf, 0, s.u);
    }

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.015, g: 0.012, b: 0.03, a: 1 } }],
    });
    pass.setPipeline(pipeline);
    for (const s of specs) { pass.setBindGroup(0, s.bind); pass.draw(3); }
    pass.end();
    device.queue.submit([enc.finish()]);
    window.__circles.frames++;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => { console.error('[circles]', e); document.getElementById('msg').style.display = 'flex'; });
