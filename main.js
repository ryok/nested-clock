import { buildLayout, buildRootGrid, hexToRgb } from './layout.js';
import { Recorder } from './recorder.js';
import { WGSL } from './shader.js';

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
  const rec = new Recorder(canvas);
  window.__circles = { counts: specs.map((s) => s.lay.n), frames: 0, rec };

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
    if (!rec.active) resize();

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
    rec.onFrame(now);
    window.__circles.frames++;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => { console.error('[circles]', e); document.getElementById('msg').style.display = 'flex'; });
