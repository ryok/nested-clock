// Cmd+D / Ctrl+D で 1 分の mp4（60fps）を書き出す。
// 録画中はキャンバスの解像度を選んだサイズに固定し、画面には縦横比を保って中央に置く。
// 時計は「録画した時間」で、rAF ごとに進む。遅れたフレームは直前の絵を伸ばし、
// 250ms を超える停止やタブが隠れたときは時計を止め、次のフレームをキーフレームにする。
import { muxMp4 } from './mp4.js';

const FPS = 60;
const TIMESCALE = 6000; // 1 フレーム = 100
const CODECS = ['avc1.64002A', 'avc1.640033', 'avc1.4D002A', 'avc1.42002A'];
const SIZES = [
  { key: 'landscape', label: 'Landscape', w: 1920, h: 1080 },
  { key: 'portrait', label: 'Portrait', w: 1080, h: 1920 },
  { key: 'square', label: 'Square', w: 1080, h: 1080 },
];

const CSS = `
#rec-modal { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center;
  background: rgba(4, 3, 8, 0.72); font: 14px system-ui; color: #dee2e6; }
#rec-modal .box { background: #121019; border: 1px solid #2a2635; border-radius: 12px; padding: 20px; display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; max-width: calc(100vw - 32px); }
#rec-modal button { background: #1a1724; color: inherit; border: 1px solid #2f2a3d; border-radius: 10px; padding: 16px 18px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 10px; min-width: 132px; font: inherit; }
#rec-modal button:hover, #rec-modal button:focus-visible { border-color: #7a4fa3; outline: none; }
#rec-modal .frame { border: 1.5px solid #adb5bd; border-radius: 3px; display: flex; align-items: center; justify-content: center; }
#rec-modal .dot, #rec-hud .dot { width: 8px; height: 8px; border-radius: 50%; background: #e5383b; display: inline-block; }
#rec-modal .sub { color: #868e96; font-size: 12px; }
#rec-hud { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 31; display: none; align-items: center; gap: 8px;
  background: rgba(18, 16, 25, 0.85); border: 1px solid #2a2635; border-radius: 999px; padding: 6px 14px; font: 13px system-ui; color: #dee2e6;
  font-variant-numeric: tabular-nums; }
#rec-hud .dot { animation: rec-blink 1s steps(1) infinite; }
#rec-hud.saved .dot { background: #2fbf71; animation: none; }
@keyframes rec-blink { 50% { opacity: 0.15; } }
`;

export class Recorder {
  constructor(canvas, { seconds = 60 } = {}) {
    this.canvas = canvas;
    this.seconds = seconds;
    this.active = false;
    this.lastBlob = null;
    this.status = 'idle';
    this.buildUi();
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (!this.active) this.openModal();
      } else if (e.key === 'Escape') this.closeModal();
    });
  }

  buildUi() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.modal = document.createElement('div');
    this.modal.id = 'rec-modal';
    const box = document.createElement('div');
    box.className = 'box';
    for (const s of SIZES) {
      const b = document.createElement('button');
      const scale = 44 / Math.max(s.w, s.h);
      b.innerHTML = `<span class="frame" style="width:${Math.round(s.w * scale)}px;height:${Math.round(s.h * scale)}px"><span class="dot"></span></span>
        <span>${s.label}</span><span class="sub">${s.w}×${s.h} · ${FPS} fps</span>`;
      b.addEventListener('click', () => { this.closeModal(); this.start(s.key); });
      box.appendChild(b);
    }
    this.modal.appendChild(box);
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.closeModal(); });
    this.hud = document.createElement('div');
    this.hud.id = 'rec-hud';
    this.hud.innerHTML = '<span class="dot"></span><span class="text"></span>';
    document.body.append(this.modal, this.hud);
  }

  openModal() { this.modal.style.display = 'flex'; this.modal.querySelector('button').focus(); }
  closeModal() { this.modal.style.display = 'none'; }
  setHud(text, saved = false) {
    this.hud.style.display = 'flex';
    this.hud.classList.toggle('saved', saved);
    this.hud.querySelector('.text').textContent = text;
  }

  // 画面上でアスペクト比を保って中央に置く（レターボックス）
  layoutCanvas() {
    const { w, h } = this.size;
    const s = Math.min(window.innerWidth / w, window.innerHeight / h);
    Object.assign(this.canvas.style, {
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      width: `${w * s}px`, height: `${h * s}px`, zIndex: '20',
    });
  }

  async pickCodec(w, h) {
    if (!('VideoEncoder' in window)) return null;
    for (const codec of CODECS) {
      const config = { codec, width: w, height: h, bitrate: 20_000_000, framerate: FPS, avc: { format: 'avc' } };
      try {
        const r = await VideoEncoder.isConfigSupported(config);
        if (r.supported) return config;
      } catch {}
    }
    return null;
  }

  async start(key, seconds = this.seconds) {
    if (this.active) return;
    this.size = SIZES.find((s) => s.key === key) || SIZES[0];
    this.duration = seconds;
    this.prevCss = this.canvas.getAttribute('style') || '';
    this.canvas.width = this.size.w;
    this.canvas.height = this.size.h;
    this.layoutCanvas();
    this.onResize = () => this.layoutCanvas();
    window.addEventListener('resize', this.onResize);

    this.samples = [];
    this.clock = 0;
    this.lastSlot = -1;
    this.lastKeySlot = -Infinity;
    this.forceKey = true;
    this.prevNow = null;
    this.error = null;
    this.status = 'starting'; // エンコーダーの準備ができるまで時計を進めない
    this.active = true;

    const config = await this.pickCodec(this.size.w, this.size.h);
    if (config) {
      this.mode = 'webcodecs';
      this.codec = config.codec;
      this.description = null;
      this.encoder = new VideoEncoder({
        output: (chunk, meta) => {
          if (meta?.decoderConfig?.description && !this.description) {
            this.description = new Uint8Array(meta.decoderConfig.description.slice(0));
          }
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          this.samples.push({ data, key: chunk.type === 'key', slot: Math.round((chunk.timestamp * FPS) / 1e6) });
        },
        error: (e) => { this.error = e; console.error('[rec]', e); },
      });
      this.encoder.configure(config);
    } else {
      this.startMediaRecorder();
    }
    this.status = 'recording';
    console.log(`[rec] start ${this.size.w}x${this.size.h} via ${this.mode}${this.codec ? ' ' + this.codec : ''}`);
  }

  startMediaRecorder() {
    this.mode = 'mediarecorder';
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    this.mrType = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const stream = this.canvas.captureStream(FPS);
    this.mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 20_000_000 });
    this.mrChunks = [];
    this.mr.ondataavailable = (e) => e.data.size && this.mrChunks.push(e.data);
    this.mr.start(1000);
  }

  // main のフレームごと、描画を submit した直後に呼ぶ
  onFrame(now) {
    if (!this.active || this.status !== 'recording') return;
    const dt = this.prevNow == null ? 0 : now - this.prevNow;
    this.prevNow = now;
    if (dt > 250 || document.hidden) {
      this.forceKey = true; // 時計は進めない
    } else {
      this.clock += dt / 1000;
    }
    const slot = Math.floor(this.clock * FPS + 1e-6);
    const total = this.duration * FPS;
    this.setHud(`REC ${fmt(this.clock)} / ${fmt(this.duration)}`);

    if (this.mode === 'webcodecs' && slot > this.lastSlot && slot < total) {
      const frame = new VideoFrame(this.canvas, { timestamp: Math.round((slot * 1e6) / FPS) });
      const keyFrame = this.forceKey || slot - this.lastKeySlot >= FPS * 2;
      this.encoder.encode(frame, { keyFrame });
      frame.close();
      if (keyFrame) this.lastKeySlot = slot;
      this.forceKey = false;
      this.lastSlot = slot;
    }
    if (slot >= total || this.error) this.finish();
  }

  async finish() {
    if (this.status !== 'recording') return;
    this.status = 'saving';
    this.setHud('Saving…');
    let blob, ext;
    try {
      if (this.mode === 'webcodecs') {
        await this.encoder.flush();
        this.encoder.close();
        if (this.error) throw this.error;
        const s = this.samples.sort((a, b) => a.slot - b.slot);
        const total = this.duration * FPS;
        // 次のサンプルまでを長さにする（遅れて飛ばした分は直前の絵が伸びる）
        const samples = s.map((x, i) => ({ data: x.data, key: x.key, dur: ((i + 1 < s.length ? s[i + 1].slot : total) - x.slot) * (TIMESCALE / FPS) }));
        blob = muxMp4({ width: this.size.w, height: this.size.h, timescale: TIMESCALE, samples, description: this.description });
        ext = 'mp4';
        this.stats = { frames: s.length, keys: s.filter((x) => x.key).length, held: total - s.length, codec: this.codec };
      } else {
        await new Promise((res) => { this.mr.onstop = res; this.mr.stop(); });
        blob = new Blob(this.mrChunks, { type: this.mrType === 'mp4' ? 'video/mp4' : 'video/webm' });
        ext = this.mrType;
        this.stats = { mode: 'mediarecorder' };
      }
      this.lastBlob = blob;
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `circles-on-spheres-${this.size.key}-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      console.log('[rec] saved', a.download, blob.size, JSON.stringify(this.stats));
      this.setHud(`Saved ${(blob.size / 1e6).toFixed(1)} MB`, true);
      this.status = 'saved';
    } catch (e) {
      console.error('[rec] failed', e);
      this.setHud('Recording failed');
      this.status = 'failed';
    }
    this.restore();
    setTimeout(() => { if (!this.active) this.hud.style.display = 'none'; }, 3000);
  }

  restore() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.setAttribute('style', this.prevCss);
    this.active = false; // 次のフレームで main がビューポートの大きさに戻す
  }
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
