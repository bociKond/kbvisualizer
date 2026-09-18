import './style.css';
import { renderMP4 } from "./browserExport";

type VisualizerStyle = 'bars' | 'waveform';

interface Settings {
  author: string;
  title: string;
  bpm: string;
  key: string;
  accent: string;
  sensitivity: number;
  barCount: number;
  style: VisualizerStyle;
}

const settings: Settings = {
  author: 'KociBond',
  title: 'MIDNIGHT DRIVE',
  bpm: '140',
  key: 'F# Minor',
  accent: '#8c8cff',
  sensitivity: 1.15,
  barCount: 64,
  style: 'bars'
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <h1>Beat Visualizer</h1>
      <p>Drop in a beat and cover, change the metadata, preview it live, then render a constant-frame-rate MP4.</p>

      <div class="field">
        <label for="audioFile">Audio</label>
        <input id="audioFile" type="file" accept="audio/*" />
      </div>

      <div class="field">
        <label for="coverFile">Cover image</label>
        <input id="coverFile" type="file" accept="image/*" />
      </div>

      <div class="field">
        <label for="author">Author</label>
        <input id="author" value="KociBond" />
      </div>

      <div class="field">
        <label for="title">Beat / song name</label>
        <input id="title" value="MIDNIGHT DRIVE" />
      </div>

      <div class="row">
        <div class="field">
          <label for="bpm">BPM</label>
          <input id="bpm" value="140" />
        </div>
        <div class="field">
          <label for="key">Key</label>
          <input id="key" value="F# Minor" />
        </div>
      </div>

      <div class="field">
        <label for="style">Visualizer</label>
        <select id="style">
          <option value="bars">Spectrum bars</option>
          <option value="waveform">Waveform</option>
        </select>
      </div>

      <div class="field">
        <label for="sensitivity">Sensitivity</label>
        <input id="sensitivity" type="range" min="0.5" max="2.5" step="0.05" value="1.15" />
      </div>

      <div class="field">
        <label for="barCount">Bar count</label>
        <input id="barCount" type="range" min="16" max="128" step="8" value="64" />
      </div>

      <div class="field">
        <label for="exportFps">Export FPS</label>
        <select id="exportFps">
          <option value="30" selected>30 FPS — mobile / faster</option>
          <option value="60">60 FPS — high quality / slower</option>
        </select>
      </div>

      <div class="field">
        <label for="accent">Accent color</label>
        <div class="color-row">
          <input id="accentText" value="#8c8cff" />
          <input id="accent" type="color" value="#8c8cff" />
        </div>
      </div>

      <div class="actions">
        <button id="exportBtn" class="primary" disabled>Export MP4</button>
        <a id="downloadBtn" class="primary download-button" hidden>Download MP4</a>
        <button id="resetBtn" class="secondary">Reset metadata</button>
      </div>
      <div id="status" class="status">Load an audio file to begin.</div>
    </aside>

    <main class="workspace">
      <div class="preview-wrap">
        <div class="preview-header">
          <span>LIVE PREVIEW</span>
          <span class="badge" id="fpsBadge">1920×1080 · 30 FPS</span>
        </div>
        <canvas id="canvas" width="1920" height="1080"></canvas>
        <div class="transport">
          <button id="playBtn" disabled>Play</button>
          <button id="pauseBtn" disabled>Pause</button>
          <button id="restartBtn" disabled>Restart</button>
        </div>
      </div>
    </main>
  </div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
const staticCanvas = document.createElement('canvas');
staticCanvas.width = canvas.width;
staticCanvas.height = canvas.height;
const staticCtx = staticCanvas.getContext('2d', { alpha: false })!;
let staticSceneDirty = true;
const audioFile = document.querySelector<HTMLInputElement>('#audioFile')!;
const coverFile = document.querySelector<HTMLInputElement>('#coverFile')!;
const playBtn = document.querySelector<HTMLButtonElement>('#playBtn')!;
const pauseBtn = document.querySelector<HTMLButtonElement>('#pauseBtn')!;
const restartBtn = document.querySelector<HTMLButtonElement>('#restartBtn')!;
const exportBtn = document.querySelector<HTMLButtonElement>('#exportBtn')!;
const downloadBtn = document.querySelector<HTMLAnchorElement>('#downloadBtn')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const exportFpsSelect = document.querySelector<HTMLSelectElement>('#exportFps')!;
const fpsBadge = document.querySelector<HTMLSpanElement>('#fpsBadge')!;

exportFpsSelect.addEventListener('change', () => {
  fpsBadge.textContent = `1920×1080 · ${exportFpsSelect.value} FPS`;
});

const audio = new Audio();
audio.preload = 'auto';
let audioUrl = '';
let cover = new Image();
let coverReady = false;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let monitorGain: GainNode | null = null;
let selectedAudioFile: File | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let frequencyData: Uint8Array<ArrayBuffer> | null = null;
let waveformData: Uint8Array<ArrayBuffer> | null = null;
let exporting = false;
let renderedVideoUrl = '';

function bindText(id: string, key: keyof Pick<Settings, 'author' | 'title' | 'bpm' | 'key'>) {
  const el = document.querySelector<HTMLInputElement>(`#${id}`)!;
  el.addEventListener('input', () => { settings[key] = el.value; staticSceneDirty = true; });
}

bindText('author', 'author');
bindText('title', 'title');
bindText('bpm', 'bpm');
bindText('key', 'key');

document.querySelector<HTMLSelectElement>('#style')!.addEventListener('change', (event) => {
  settings.style = (event.target as HTMLSelectElement).value as VisualizerStyle;
});
document.querySelector<HTMLInputElement>('#sensitivity')!.addEventListener('input', (event) => {
  settings.sensitivity = Number((event.target as HTMLInputElement).value);
});
document.querySelector<HTMLInputElement>('#barCount')!.addEventListener('input', (event) => {
  settings.barCount = Number((event.target as HTMLInputElement).value);
});

const accentPicker = document.querySelector<HTMLInputElement>('#accent')!;
const accentText = document.querySelector<HTMLInputElement>('#accentText')!;
function setAccent(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    settings.accent = value;
    accentPicker.value = value;
    accentText.value = value;
    staticSceneDirty = true;
  }
}
accentPicker.addEventListener('input', () => setAccent(accentPicker.value));
accentText.addEventListener('change', () => setAccent(accentText.value));

coverFile.addEventListener('change', () => {
  const file = coverFile.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const next = new Image();
  next.onload = () => {
    cover = next;
    coverReady = true;
    staticSceneDirty = true;
    URL.revokeObjectURL(url);
  };
  next.src = url;
});

audioFile.addEventListener('change', async () => {
  const file = audioFile.files?.[0];
  if (!file) return;
  selectedAudioFile = file;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  audio.src = audioUrl;
  await setupAudioGraph();
  playBtn.disabled = false;
  pauseBtn.disabled = false;
  restartBtn.disabled = false;
  exportBtn.disabled = false;
  status.textContent = `${file.name} loaded.`;
});

async function setupAudioGraph() {
  if (!audioContext) audioContext = new AudioContext();
  if (!sourceNode) sourceNode = audioContext.createMediaElementSource(audio);
  if (!analyser) {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    waveformData = new Uint8Array(analyser.fftSize);
  }
  if (!monitorGain) {
    monitorGain = audioContext.createGain();
    monitorGain.gain.value = 1;
  }

  try { sourceNode.disconnect(); } catch { }
  try { analyser.disconnect(); } catch { }
  try { monitorGain.disconnect(); } catch { }

  sourceNode.connect(analyser);
  analyser.connect(monitorGain);
  monitorGain.connect(audioContext.destination);
}

playBtn.addEventListener('click', async () => {
  if (!audioContext) return;
  await audioContext.resume();
  await audio.play();
});
pauseBtn.addEventListener('click', () => audio.pause());
restartBtn.addEventListener('click', async () => {
  audio.currentTime = 0;
  if (audioContext) await audioContext.resume();
  await audio.play();
});

document.querySelector<HTMLButtonElement>('#resetBtn')!.addEventListener('click', () => {
  const values = { author: 'KociBond', title: 'MIDNIGHT DRIVE', bpm: '140', key: 'F# Minor' };
  (Object.keys(values) as Array<keyof typeof values>).forEach((key) => {
    settings[key] = values[key];
    document.querySelector<HTMLInputElement>(`#${key}`)!.value = values[key];
    staticSceneDirty = true;
  });
});

function roundedRect(target: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  target.beginPath();
  target.roundRect(x, y, w, h, r);
}

function drawBackground(target: CanvasRenderingContext2D) {
  target.save();
  target.fillStyle = '#08090d';
  target.fillRect(0, 0, canvas.width, canvas.height);

  if (coverReady) {
    // This blur is intentionally done only when the static scene changes,
    // not once per animation frame.
    target.globalAlpha = 0.42;
    target.filter = 'blur(45px) brightness(0.45)';
    const scale = Math.max(canvas.width / cover.width, canvas.height / cover.height) * 1.15;
    const w = cover.width * scale;
    const h = cover.height * scale;
    target.drawImage(cover, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    target.filter = 'none';
    target.globalAlpha = 1;
  }

  const gradient = target.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(5,6,10,0.12)');
  gradient.addColorStop(0.72, 'rgba(5,6,10,0.4)');
  gradient.addColorStop(1, 'rgba(5,6,10,0.88)');
  target.fillStyle = gradient;
  target.fillRect(0, 0, canvas.width, canvas.height);
  target.restore();
}

function drawArtwork(target: CanvasRenderingContext2D) {
  const size = 400;
  const x = (canvas.width - size) / 2;
  const y = 155;

  target.save();
  target.shadowColor = 'rgba(0,0,0,0.55)';
  target.shadowBlur = 45;
  roundedRect(target, x, y, size, size, 30);
  target.clip();
  if (coverReady) {
    target.drawImage(cover, x, y, size, size);
  } else {
    const g = target.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, settings.accent);
    g.addColorStop(1, '#161923');
    target.fillStyle = g;
    target.fillRect(x, y, size, size);
    target.fillStyle = 'rgba(255,255,255,.75)';
    target.font = '700 34px Inter, sans-serif';
    target.textAlign = 'center';
    target.fillText('COVER', canvas.width / 2, y + size / 2 + 10);
  }
  target.restore();
}

function drawMetadata(target: CanvasRenderingContext2D) {
  target.save();
  target.textAlign = 'center';
  target.fillStyle = '#ffffff';
  target.font = '800 62px Inter, sans-serif';
  target.fillText(settings.title || 'UNTITLED', canvas.width / 2, 660);

  target.fillStyle = 'rgba(255,255,255,.78)';
  target.font = '600 28px Inter, sans-serif';
  target.fillText(settings.author || 'Unknown Artist', canvas.width / 2, 710);

  const info = [settings.bpm ? `${settings.bpm} BPM` : '', settings.key].filter(Boolean).join('  •  ');
  target.fillStyle = 'rgba(255,255,255,.55)';
  target.font = '500 22px Inter, sans-serif';
  target.fillText(info, canvas.width / 2, 752);
  target.restore();
}

function rebuildStaticScene() {
  drawBackground(staticCtx);
  drawArtwork(staticCtx);
  drawMetadata(staticCtx);
  staticSceneDirty = false;
}

function drawBars() {
  if (!analyser || !frequencyData) return;
  analyser.getByteFrequencyData(frequencyData);

  const barCount = settings.barCount;
  const regionW = 1280;
  const startX = (canvas.width - regionW) / 2;
  const baseY = 925;
  const maxH = 120;
  const gap = 5;
  const barW = (regionW - gap * (barCount - 1)) / barCount;

  ctx.save();
  ctx.fillStyle = settings.accent;
  ctx.shadowColor = settings.accent;
  ctx.shadowBlur = 12;
  ctx.beginPath();

  for (let i = 0; i < barCount; i++) {
    const dataIndex = Math.floor((i / barCount) * Math.min(frequencyData.length, 430));
    const value = Math.min(1, (frequencyData[dataIndex] / 255) * settings.sensitivity);
    const h = Math.max(3, value * maxH);
    const x = startX + i * (barW + gap);
    ctx.roundRect(x, baseY - h, barW, h, Math.min(7, barW / 2));
  }
  // One fill call means one shadow pass for the whole spectrum instead of one per bar.
  ctx.fill();
  ctx.restore();
}

function drawWaveform() {
  if (!analyser || !waveformData) return;
  analyser.getByteTimeDomainData(waveformData);
  const startX = 320;
  const endX = canvas.width - 320;
  const centerY = 875;
  const amp = 90 * settings.sensitivity;

  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = settings.accent;
  ctx.shadowColor = settings.accent;
  ctx.shadowBlur = 18;

  for (let i = 0; i < waveformData.length; i += 8) {
    const t = i / (waveformData.length - 1);
    const x = startX + (endX - startX) * t;
    const normalized = (waveformData[i] - 128) / 128;
    const y = centerY + normalized * amp;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}


class ExportSpectrumAnalyzer {
  private readonly fftSize = 2048;
  private readonly real = new Float64Array(this.fftSize);
  private readonly imag = new Float64Array(this.fftSize);
  private readonly bitReverse = new Uint16Array(this.fftSize);
  private readonly window = new Float64Array(this.fftSize);
  private readonly bars: Float32Array;
  private readonly channels: Float32Array[];
  private lastAnalysisBucket = -1;

  constructor(private readonly buffer: AudioBuffer, barCount: number) {
    this.bars = new Float32Array(barCount);
    this.channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));

    const bits = Math.log2(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      let value = i;
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) {
        reversed = (reversed << 1) | (value & 1);
        value >>= 1;
      }
      this.bitReverse[i] = reversed;
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.fftSize - 1));
    }
  }

  analyze(time: number, sensitivity: number): Float32Array {
    // 30 analyses per second is enough for smooth movement, even in a 60 FPS export.
    // At 60 FPS each analysis result is simply used for two adjacent frames.
    const bucket = Math.floor(time * 30);
    if (bucket === this.lastAnalysisBucket) return this.bars;

    const centerSample = Math.floor(time * this.buffer.sampleRate);
    const startSample = centerSample - Math.floor(this.fftSize / 2);

    for (let i = 0; i < this.fftSize; i++) {
      const sampleIndex = startSample + i;
      let sample = 0;

      if (sampleIndex >= 0 && sampleIndex < this.buffer.length) {
        for (let channel = 0; channel < this.channels.length; channel++) {
          sample += this.channels[channel][sampleIndex] ?? 0;
        }
        sample /= Math.max(1, this.channels.length);
      }

      const reversed = this.bitReverse[i];
      this.real[reversed] = sample * this.window[i];
      this.imag[reversed] = 0;
    }

    for (let size = 2; size <= this.fftSize; size <<= 1) {
      const half = size >> 1;
      const angle = (-2 * Math.PI) / size;

      for (let start = 0; start < this.fftSize; start += size) {
        for (let offset = 0; offset < half; offset++) {
          const phase = angle * offset;
          const cos = Math.cos(phase);
          const sin = Math.sin(phase);
          const even = start + offset;
          const odd = even + half;

          const oddReal = this.real[odd] * cos - this.imag[odd] * sin;
          const oddImag = this.real[odd] * sin + this.imag[odd] * cos;
          const evenReal = this.real[even];
          const evenImag = this.imag[even];

          this.real[even] = evenReal + oddReal;
          this.imag[even] = evenImag + oddImag;
          this.real[odd] = evenReal - oddReal;
          this.imag[odd] = evenImag - oddImag;
        }
      }
    }

    const maxBin = Math.min(430, this.fftSize / 2 - 1);
    const firstFrame = this.lastAnalysisBucket < 0;

    for (let i = 0; i < this.bars.length; i++) {
      const bin = Math.max(1, Math.floor((i / this.bars.length) * maxBin));
      const magnitude = Math.hypot(this.real[bin], this.imag[bin]) / (this.fftSize / 2);
      const db = 20 * Math.log10(Math.max(1e-7, magnitude));
      let value = Math.max(0, Math.min(1, (db + 68) / 68));
      value = Math.pow(value, 1.35);
      value = Math.min(1, value * sensitivity);

      // Similar to the live AnalyserNode smoothing, but deterministic.
      this.bars[i] = firstFrame ? value : this.bars[i] * 0.72 + value * 0.28;
    }

    this.lastAnalysisBucket = bucket;
    return this.bars;
  }
}

function drawExportBars(
  target: CanvasRenderingContext2D,
  spectrum: ExportSpectrumAnalyzer,
  time: number,
  exportSettings: Settings
) {
  const bars = spectrum.analyze(time, exportSettings.sensitivity);
  const barCount = bars.length;
  const regionW = 1280;
  const startX = (canvas.width - regionW) / 2;
  const baseY = 925;
  const maxH = 120;
  const gap = 5;
  const barW = (regionW - gap * (barCount - 1)) / barCount;

  target.save();
  target.fillStyle = exportSettings.accent;
  target.shadowColor = exportSettings.accent;
  target.shadowBlur = 12;
  target.beginPath();

  for (let i = 0; i < barCount; i++) {
    const h = Math.max(3, bars[i] * maxH);
    const x = startX + i * (barW + gap);
    target.roundRect(x, baseY - h, barW, h, Math.min(7, barW / 2));
  }

  target.fill();
  target.restore();
}

function drawExportWaveform(
  target: CanvasRenderingContext2D,
  buffer: AudioBuffer,
  time: number,
  exportSettings: Settings
) {
  const startX = 320;
  const endX = canvas.width - 320;
  const centerY = 875;
  const amp = 90 * exportSettings.sensitivity;
  const pointCount = 256;
  const windowSamples = 2048;
  const centerSample = Math.floor(time * buffer.sampleRate);
  const firstSample = centerSample - Math.floor(windowSamples / 2);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));

  target.save();
  target.beginPath();
  target.lineWidth = 6;
  target.lineJoin = 'round';
  target.lineCap = 'round';
  target.strokeStyle = exportSettings.accent;
  target.shadowColor = exportSettings.accent;
  target.shadowBlur = 18;

  for (let i = 0; i < pointCount; i++) {
    const ratio = i / (pointCount - 1);
    const sampleIndex = firstSample + Math.floor(ratio * (windowSamples - 1));
    let sample = 0;

    if (sampleIndex >= 0 && sampleIndex < buffer.length) {
      for (let channel = 0; channel < channels.length; channel++) {
        sample += channels[channel][sampleIndex] ?? 0;
      }
      sample /= Math.max(1, channels.length);
    }

    const x = startX + (endX - startX) * ratio;
    const y = centerY + sample * amp;
    if (i === 0) target.moveTo(x, y);
    else target.lineTo(x, y);
  }

  target.stroke();
  target.restore();
}

function drawProgressAt(
  target: CanvasRenderingContext2D,
  currentTime: number,
  duration: number,
  accent: string
) {
  const x = 320;
  const y = 1000;
  const w = canvas.width - 640;
  const ratio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  target.save();
  target.fillStyle = 'rgba(255,255,255,.16)';
  roundedRect(target, x, y, w, 8, 4);
  target.fill();

  target.fillStyle = accent;
  if (ratio > 0) {
    roundedRect(target, x, y, w * ratio, 8, 4);
    target.fill();
  }

  target.font = '500 20px Inter, sans-serif';
  target.fillStyle = 'rgba(255,255,255,.55)';
  target.textAlign = 'left';
  target.fillText(formatTime(currentTime), x, y - 18);
  target.textAlign = 'right';
  target.fillText(formatTime(duration), x + w, y - 18);
  target.restore();
}

function drawExportFrame(
  buffer: AudioBuffer,
  time: number,
  exportSettings: Settings,
  spectrum: ExportSpectrumAnalyzer
) {
  ctx.drawImage(staticCanvas, 0, 0);

  if (exportSettings.style === 'bars') drawExportBars(ctx, spectrum, time, exportSettings);
  else drawExportWaveform(ctx, buffer, time, exportSettings);

  drawProgressAt(ctx, time, buffer.duration, exportSettings.accent);
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function drawProgress() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  drawProgressAt(ctx, audio.currentTime, duration, settings.accent);
}

let renderFrameCounter = 0;
let renderFpsWindowStart = performance.now();
let measuredRenderFps = 60;

function render(now = performance.now()) {
  if (!exporting) {
    if (staticSceneDirty) rebuildStaticScene();
    ctx.drawImage(staticCanvas, 0, 0);
    if (settings.style === 'bars') drawBars();
    else drawWaveform();
    drawProgress();

    renderFrameCounter++;
    const elapsed = now - renderFpsWindowStart;
    if (elapsed >= 1000) {
      measuredRenderFps = (renderFrameCounter * 1000) / elapsed;
      renderFrameCounter = 0;
      renderFpsWindowStart = now;
    }
  }

  requestAnimationFrame(render);
}
render();

function exposeDownload(blob: Blob, fileName: string) {
  if (renderedVideoUrl) URL.revokeObjectURL(renderedVideoUrl);
  renderedVideoUrl = URL.createObjectURL(blob);
  downloadBtn.href = renderedVideoUrl;
  downloadBtn.download = fileName;
  downloadBtn.textContent = `Download ${fileName.endsWith('.mp4') ? 'MP4' : 'video'} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`;
  downloadBtn.hidden = false;
}

exportBtn.addEventListener('click', async () => {
  if (!selectedAudioFile || exporting) return;

  exporting = true;
  exportBtn.disabled = true;
  playBtn.disabled = true;
  pauseBtn.disabled = true;
  restartBtn.disabled = true;

  try {
    if (renderedVideoUrl) {
      URL.revokeObjectURL(renderedVideoUrl);
      renderedVideoUrl = '';
    }
    downloadBtn.hidden = true;
    downloadBtn.removeAttribute('href');
    downloadBtn.removeAttribute('download');

    audio.pause();
    audio.currentTime = 0;

    // Freeze the current look for the whole render.
    if (staticSceneDirty) rebuildStaticScene();
    const exportSettings: Settings = { ...settings };
    const exportFps = Number(exportFpsSelect.value) === 60 ? 60 : 30;

    status.textContent = 'Decoding audio in your browser…';
    const audioBuffer = await decodeAudioFile(selectedAudioFile);
    const spectrum = new ExportSpectrumAnalyzer(audioBuffer, exportSettings.barCount);

    const safeAuthor = (exportSettings.author || 'artist').replace(/[^a-z0-9-_ ]/gi, '').trim();
    const safeTitle = (exportSettings.title || 'visualizer').replace(/[^a-z0-9-_ ]/gi, '').trim();
    const baseName = `${safeAuthor || 'artist'} - ${safeTitle || 'visualizer'}`;

    const videoBitrate = exportFps === 60 ? 12_000_000 : 8_000_000;

    const mp4 = await renderMP4({
      canvas,
      audioBuffer,
      fps: exportFps,
      videoBitrate,
      audioBitrate: 192_000,
      drawFrame: (time) => {
        drawExportFrame(audioBuffer, time, exportSettings, spectrum);
      },
      onProgress: (progress) => {
        const percent = Math.round(progress * 100);
        status.textContent = `Rendering ${exportFps} FPS MP4 locally on this device… ${percent}%`;
      }
    });

    if (mp4.size === 0) throw new Error('The browser encoder returned an empty MP4 file.');

    exposeDownload(mp4, `${baseName}.mp4`);
    status.textContent = `${exportFps} FPS MP4 ready (${(mp4.size / 1024 / 1024).toFixed(1)} MB). Click Download MP4 to save it.`;
  } catch (error) {
    console.error(error);
    status.textContent = error instanceof Error ? error.message : 'Export failed.';
  } finally {
    audio.currentTime = 0;
    exporting = false;
    exportBtn.disabled = false;
    playBtn.disabled = false;
    pauseBtn.disabled = false;
    restartBtn.disabled = false;
    renderFpsWindowStart = performance.now();
    renderFrameCounter = 0;
  }
});

async function decodeAudioFile(file: File): Promise<AudioBuffer> {

  const audioContext = new AudioContext();

  const arrayBuffer = await file.arrayBuffer();

  const audioBuffer =
    await audioContext.decodeAudioData(arrayBuffer);

  await audioContext.close();

  return audioBuffer;
}