import './style.css';

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
          <option value="60" selected>60 FPS — recommended</option>
          <option value="30">30 FPS</option>
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
          <span class="badge" id="fpsBadge">1920×1080 · 60 FPS</span>
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
let mediaDestination: MediaStreamAudioDestinationNode | null = null;
let monitorGain: GainNode | null = null;
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
  if (!mediaDestination) mediaDestination = audioContext.createMediaStreamDestination();
  if (!monitorGain) {
    monitorGain = audioContext.createGain();
    monitorGain.gain.value = 1;
  }

  try { sourceNode.disconnect(); } catch {}
  try { analyser.disconnect(); } catch {}
  try { monitorGain.disconnect(); } catch {}

  sourceNode.connect(analyser);
  analyser.connect(monitorGain);
  monitorGain.connect(audioContext.destination);
  analyser.connect(mediaDestination);
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

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function drawProgress() {
  const x = 320;
  const y = 1000;
  const w = canvas.width - 640;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const ratio = duration > 0 ? Math.min(1, audio.currentTime / duration) : 0;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  roundedRect(ctx, x, y, w, 8, 4);
  ctx.fill();

  ctx.fillStyle = settings.accent;
  roundedRect(ctx, x, y, w * ratio, 8, 4);
  ctx.fill();

  ctx.font = '500 20px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.textAlign = 'left';
  ctx.fillText(formatTime(audio.currentTime), x, y - 18);
  ctx.textAlign = 'right';
  ctx.fillText(formatTime(duration), x + w, y - 18);
  ctx.restore();
}

let renderFrameCounter = 0;
let renderFpsWindowStart = performance.now();
let measuredRenderFps = 60;

function render(now = performance.now()) {
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

  requestAnimationFrame(render);
}
render();

type RecorderFormat = { mimeType: string };

function bestRecorderFormat(): RecorderFormat {
  const webmOptions = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  for (const mimeType of webmOptions) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
  }

  throw new Error('This browser does not expose a supported WebM MediaRecorder format.');
}

function exposeDownload(blob: Blob, fileName: string) {
  if (renderedVideoUrl) URL.revokeObjectURL(renderedVideoUrl);
  renderedVideoUrl = URL.createObjectURL(blob);
  downloadBtn.href = renderedVideoUrl;
  downloadBtn.download = fileName;
  downloadBtn.textContent = `Download ${fileName.endsWith('.mp4') ? 'MP4' : 'video'} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`;
  downloadBtn.hidden = false;
}

exportBtn.addEventListener('click', async () => {
  if (!audio.src || !audioContext || !mediaDestination || !monitorGain || exporting) return;
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

    await audioContext.resume();
    audio.pause();
    audio.currentTime = 0;
    monitorGain.gain.value = 0;

    const exportFps = Number(exportFpsSelect.value) === 30 ? 30 : 60;
    const canvasStream = canvas.captureStream(exportFps);
    const audioTrack = mediaDestination.stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error('No audio track was available for export.');
    canvasStream.addTrack(audioTrack);

    const format = bestRecorderFormat();
    status.textContent = `Recording ${exportFps} FPS in real time… renderer currently ~${Math.round(measuredRenderFps)} FPS. Keep this tab visible.`;

    const recorder = new MediaRecorder(canvasStream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: exportFps === 60 ? 20_000_000 : 12_000_000,
      audioBitsPerSecond: 320_000
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('The browser MediaRecorder reported an export error.'));
    });

    const finished = new Promise<void>((resolve) => {
      const onEnded = () => {
        audio.removeEventListener('ended', onEnded);
        resolve();
      };
      audio.addEventListener('ended', onEnded);
    });

    recorder.start(1000);
    await audio.play();
    await finished;
    recorder.stop();
    await stopped;

    if (chunks.length === 0) throw new Error('Recording finished but the browser produced no video data.');

    const safeAuthor = (settings.author || 'artist').replace(/[^a-z0-9-_ ]/gi, '').trim();
    const safeTitle = (settings.title || 'visualizer').replace(/[^a-z0-9-_ ]/gi, '').trim();
    const baseName = `${safeAuthor || 'artist'} - ${safeTitle || 'visualizer'}`;
    const recordedBlob = new Blob(chunks, { type: recorder.mimeType || format.mimeType });

    if (recordedBlob.size === 0) throw new Error('Recording finished but the output file was empty.');

    status.textContent = `Recording finished. Converting to constant ${exportFps} FPS H.264 MP4 with FFmpeg…`;
    const response = await fetch(`/api/convert?fps=${exportFps}`, {
      method: 'POST',
      headers: { 'Content-Type': recordedBlob.type || 'video/webm' },
      body: recordedBlob
    });

    if (!response.ok) throw new Error(await response.text());
    const mp4 = await response.blob();
    if (mp4.size === 0) throw new Error('FFmpeg returned an empty MP4 file.');
    exposeDownload(mp4, `${baseName}.mp4`);
    status.textContent = `${exportFps} FPS MP4 ready. Renderer averaged around ${Math.round(measuredRenderFps)} FPS near the end. Click Download MP4 to save it.`;
  } catch (error) {
    console.error(error);
    status.textContent = error instanceof Error ? error.message : 'Export failed.';
  } finally {
    monitorGain.gain.value = 1;
    audio.currentTime = 0;
    exporting = false;
    exportBtn.disabled = false;
    playBtn.disabled = false;
    pauseBtn.disabled = false;
    restartBtn.disabled = false;
  }
});
