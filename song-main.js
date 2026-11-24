// 曲の入れ子（試作）: 曲の構造を入れ子の円にし、再生中の円だけが、その長さでちょうど1周する。
// 今は仮の曲（音なし）。時計は t（拍）だけで決まる純粋関数にしてある（オフライン書き出しのため）
import { buildLayout, buildRootGrid, hexToRgb } from './layout.js';
import { syntheticSong, songToTree, scoreToTree, packTree, flattenTree } from './songtree.js';
import { WGSL, FOCAL } from './shader.js';
import { Recorder } from './recorder.js';

const DUSK = [['#2b1b4a', 3], ['#4b2c7a', 3], ['#7a4fa3', 2], ['#b48ec9', 1.5], ['#e0c3fc', 0.6], ['#1b1333', 2], ['#3d5a80', 1.5], ['#16213e', 1.5], ['#c05299', 0.8]];
const STRUCT = [['#0b2545', 2], ['#1f4e79', 2], ['#264653', 1.5], ['#13315c', 1.5]];
const EYE = [0, 0, 3.4];
const RING = 0.72; // 鳴る前の音の輪の、穴の半径（自分の半径に対する比）

function mul(a, b, o = new Array(9)) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function rotAxis(ax, ang, o = new Array(9)) {
  let [x, y, z] = ax;
  const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  o[0] = t * x * x + c; o[1] = t * x * y - s * z; o[2] = t * x * z + s * y;
  o[3] = t * x * y + s * z; o[4] = t * y * y + c; o[5] = t * y * z - s * x;
  o[6] = t * x * z - s * y; o[7] = t * y * z + s * x; o[8] = t * z * z + c;
  return o;
}
const apply = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

async function main() {
  const msg = document.getElementById('msg');
  if (!navigator.gpu) { msg.style.display = 'flex'; return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { msg.style.display = 'flex'; return; }
  const device = await adapter.requestDevice();
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const q = new URLSearchParams(location.search);
  // 既定は score.json（この作品の曲）。?synthetic で試作1の仮の曲
  const synthetic = q.has('synthetic');
  const song = synthetic ? syntheticSong(Number(q.get('song')) || 3) : await (await fetch('./score.json', { cache: 'no-store' })).json();
  const tree = packTree(synthetic ? songToTree(song) : scoreToTree(song), { seed: Number(q.get('seed')) || 1, exp: Number(q.get('exp')) || undefined, scale: Number(q.get('fill')) || undefined });
  const lay = flattenTree(tree, { palette: STRUCT, trackColors: song.tracks.map((t) => t.color) });
  const songBeats = tree.dur;
  const secPerBeat = 60 / song.bpm;

  const specs = [
    { name: 'outer', lay: buildLayout({ thMin: 0.004, thMax: 0.4, palette: DUSK, seed: 3 }), gap: '#08060f', radius: 9, dim: 0.45, mode: 0 },
    { name: 'inner', lay, gap: '#050a12', radius: 1, dim: 1, mode: 1 },
  ];
  console.log(`[song] circles=${lay.n} beats=${songBeats} bpm=${song.bpm}`);

  const module = device.createShaderModule({ code: WGSL });
  const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const pipeline = device.createRenderPipeline({
    layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' },
  });
  const buf = (data) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  for (const s of specs) {
    const L = s.lay, n = L.n;
    s.grid = buildRootGrid(L);
    s.data = new Float32Array(n * 12);
    s.W = new Float64Array(n * 9);
    s.ubuf = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    s.cbuf = device.createBuffer({ size: s.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    s.bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [s.ubuf, s.cbuf, buf(s.grid.cells), buf(s.grid.items)].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    s.u = new ArrayBuffer(144); s.uf = new Float32Array(s.u); s.uu = new Uint32Array(s.u);
    s.gapRgb = hexToRgb(s.gap);
    s.grid.params.forEach(([nlat, naz, off], lv) => s.uu.set([nlat, naz, off, 0], 20 + lv * 4));
    s.uu.set([s.grid.tail[0], s.grid.tail[1], 0, 0], 32);
    for (let i = 0; i < n; i++) {
      const o = i * 12;
      s.data[o + 3] = Math.cos(L.th[i]);
      s.data.set([L.center[i * 3], L.center[i * 3 + 1], L.center[i * 3 + 2], L.kidStart[i]], o + 4);
      s.data.set([L.color[i * 3], L.color[i * 3 + 1], L.color[i * 3 + 2], L.kidCount[i]], o + 8);
    }
  }

  // ---- 状態はすべて t（秒）の関数 ----
  const tmpR = new Array(9), tmpW = new Array(9);
  // 内側の球: 再生中の円だけが、自分の長さで1周する。ノートは鳴った瞬間に光って減衰
  function updateSong(s, rootM, beat) {
    const L = s.lay, W = s.W, D = s.data;
    let activeBar = -1;
    for (let i = 0; i < L.n; i++) {
      const p = L.parent[i];
      const P = p < 0 ? rootM : W.subarray(p * 9, p * 9 + 9);
      const cx = L.center[i * 3], cy = L.center[i * 3 + 1], cz = L.center[i * 3 + 2];
      const u = (beat - L.start[i]) / L.dur[i];
      const active = u >= 0 && u < 1;
      rotAxis([cx, cy, cz], -2 * Math.PI * Math.min(1, Math.max(0, u)), tmpR);
      mul(P, tmpR, tmpW);
      W.set(tmpW, i * 9);
      const o = i * 12;
      D[o] = P[0] * cx + P[1] * cy + P[2] * cz;
      D[o + 1] = P[3] * cx + P[4] * cy + P[5] * cz;
      D[o + 2] = P[6] * cx + P[7] * cy + P[8] * cz;
      let k;
      if (L.kind[i] === 3) {
        // 音は輪で始まり、鳴っているあいだに内側が満ちていく。鳴り終わった音は塗りつぶし
        const since = beat - L.start[i];
        k = since < 0 ? 0.45 : active ? 0.9 + 1.4 * Math.exp(-since * 3) : 0.55;
        D[o + 7] = since < 0 ? RING : active ? RING * (1 - u) : 0;
        D[o + 11] = -(p + 1);
      } else {
        k = active ? 1.25 : u < 0 ? 0.55 : 0.8;
      }
      D[o + 8] = L.color[i * 3] * k; D[o + 9] = L.color[i * 3 + 1] * k; D[o + 10] = L.color[i * 3 + 2] * k;
      // カメラが追うのは、いま鳴っている和音（なければ一番長い周期）
      if (active && L.kind[i] === 1 && (activeBar < 0 || L.track[i] === 0 || (L.track[activeBar] !== 0 && L.dur[i] > L.dur[activeBar]))) activeBar = i;
    }
    return activeBar;
  }
  function updateOuter(s, rootM, t) {
    const L = s.lay, W = s.W, D = s.data;
    for (let i = 0; i < L.n; i++) {
      const p = L.parent[i];
      const P = p < 0 ? rootM : W.subarray(p * 9, p * 9 + 9);
      const cx = L.center[i * 3], cy = L.center[i * 3 + 1], cz = L.center[i * 3 + 2];
      rotAxis([cx, cy, cz], L.omega[i] * t * 0.25, tmpR);
      mul(P, tmpR, tmpW);
      W.set(tmpW, i * 9);
      const o = i * 12;
      D[o] = P[0] * cx + P[1] * cy + P[2] * cz; D[o + 1] = P[3] * cx + P[4] * cy + P[5] * cz; D[o + 2] = P[6] * cx + P[7] * cy + P[8] * cz;
    }
  }

  // カメラは再生中の小節を正面へ運ぶ（固定 dt で進めるので、書き出しでも同じ動きになる）
  let root = rotAxis([1, 0, 0], 0.25);
  const VIEW = (() => { const v = [0.25, 0.2, 1]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
  let lastBar = -1;
  function follow(dt) {
    if (lastBar < 0) return;
    const D = specs[1].data; // 親の回転も入った世界座標の中心
    const w = [D[lastBar * 12], D[lastBar * 12 + 1], D[lastBar * 12 + 2]];
    const ax = [w[1] * VIEW[2] - w[2] * VIEW[1], w[2] * VIEW[0] - w[0] * VIEW[2], w[0] * VIEW[1] - w[1] * VIEW[0]];
    const s = Math.hypot(...ax), c = w[0] * VIEW[0] + w[1] * VIEW[1] + w[2] * VIEW[2];
    if (s < 1e-6) return;
    const angle = Math.atan2(s, c);
    root = mul(rotAxis(ax, angle * (1 - Math.exp(-dt * 1.6))), root);
  }

  function resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  // loop=false（書き出し）では曲の終わりで止める（余韻のあいだ、すべての円は鳴り終わった状態）
  function renderAt(t, dt, loop = true) {
    const beat = loop ? (t / secPerBeat) % songBeats : t / secPerBeat;
    follow(dt);
    const outerRoot = mul(mul(root, rotAxis([0.6, 0, 0.8], 1.1)), rotAxis([0, 1, 0], -0.04 * t));
    updateOuter(specs[0], outerRoot, t);
    lastBar = updateSong(specs[1], root, beat);
    for (const s of specs) {
      const R = s.name === 'inner' ? root : outerRoot;
      device.queue.writeBuffer(s.cbuf, 0, s.data);
      s.uf.set([R[0], R[3], R[6], s.gapRgb[0], R[1], R[4], R[7], s.gapRgb[1], R[2], R[5], R[8], s.gapRgb[2]], 0);
      s.uf.set([canvas.width, canvas.height, s.radius, s.dim, s.mode, 0, 0, 0], 12);
      device.queue.writeBuffer(s.ubuf, 0, s.u);
    }
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.015, g: 0.012, b: 0.03, a: 1 } }] });
    pass.setPipeline(pipeline);
    for (const s of specs) { pass.setBindGroup(0, s.bind); pass.draw(3); }
    pass.end();
    device.queue.submit([enc.finish()]);
    return beat;
  }

  // ---- 時計 ----
  // 音（song.wav）があれば、AudioContext の再生時刻を時計にする（画面のフレームとは独立）。
  // なければ画面の時計で回す（音なしの確認用）
  const offset = Number(q.get('t')) || 0;
  const tailSec = (song.tail || 0) * secPerBeat;
  const songSec = songBeats * secPerBeat;
  let audio = null;
  try {
    const res = await fetch('./song.wav', { cache: 'no-store' });
    if (res.ok) {
      const actx = new AudioContext();
      const buffer = await actx.decodeAudioData(await res.arrayBuffer());
      audio = { actx, buffer, src: null, at: 0 };
      console.log(`[song] audio ${buffer.duration.toFixed(2)}s (score ${songSec.toFixed(2)}s + tail ${tailSec.toFixed(2)}s)`);
    }
  } catch (e) { console.warn('[song] no audio', e); }
  const hint = document.getElementById('hint');
  function playFrom(sec) {
    if (!audio) return;
    if (audio.src) { audio.src.onended = null; audio.src.stop(); }
    const src = audio.actx.createBufferSource();
    src.buffer = audio.buffer;
    src.connect(audio.actx.destination);
    audio.at = audio.actx.currentTime + 0.05 - sec;
    src.start(audio.actx.currentTime + 0.05, sec);
    src.onended = () => { playFrom(0); };
    audio.src = src;
  }
  if (audio && hint) { hint.textContent = 'click to play'; hint.style.display = 'block'; }
  window.addEventListener('pointerdown', async () => {
    if (!audio || audio.src) return;
    await audio.actx.resume();
    playFrom(offset);
    if (hint) hint.style.display = 'none';
  });

  const rec = new Recorder(canvas, { seconds: 60 });
  let exporting = false;
  // 書き出し: ?export=landscape|portrait|square で、曲の頭から余韻の終わりまでを t = フレーム番号 / 60 で描く
  async function exportVideo(key, seconds = songSec + tailSec) {
    exporting = true;
    root = rotAxis([1, 0, 0], 0.25);
    lastBar = -1;
    try {
      await rec.exportOffline(key, seconds, (t, dt) => renderAt(t, dt, false), 'nested-clock');
    } finally { exporting = false; }
  }

  const t0 = performance.now();
  let prev = t0;
  window.__song = { frames: 0, n: lay.n, beat: 0, rec, exportVideo, audio: !!audio };
  function frame(now) {
    requestAnimationFrame(frame);
    if (exporting) return;
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    if (!rec.active) resize();
    const t = audio && audio.src ? audio.actx.currentTime - audio.at : offset + (now - t0) / 1000;
    window.__song.beat = renderAt(t, dt, !(audio && audio.src));
    window.__song.frames++;
  }
  requestAnimationFrame(frame);
  if (q.get('export')) exportVideo(q.get('export'));
}

main().catch((e) => { console.error('[song]', e); document.getElementById('msg').style.display = 'flex'; });
