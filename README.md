# Beat Visualizer Example v1.1

A small Vite + TypeScript beat visualizer example.

## What changed in v1.1

The export path now prefers direct MP4 recording in browsers that support `MediaRecorder` with MP4/H.264/AAC. That means the app can finish the render and expose the MP4 immediately without first uploading a huge WebM recording back into the Vite server.

If direct MP4 recording is not supported, the app falls back to WebM and converts it with local FFmpeg. That fallback now streams the temporary files instead of buffering the entire video several times in RAM.

## Run

1. Install Node.js.
2. Install FFmpeg and make sure `ffmpeg -version` works in the same terminal you will use for Vite. FFmpeg is only required for the WebM fallback.
3. Open this folder in a terminal.
4. Run:

```bash
npm install
npm run dev
```

5. Open the local URL shown by Vite.

## Export

1. Load an audio file.
2. Optionally load cover art and edit metadata.
3. Click **Export MP4**.
4. The render runs in real time for the length of the song.
5. When finished, a **Download MP4** button appears below the export button.

The status text tells you whether the browser is recording directly to MP4 or using the FFmpeg fallback.

## If export still fails

Open DevTools with `F12`, go to **Console**, export a short 5–10 second audio file, and copy the exact red error message. Also check the status text shown under the buttons.

For the FFmpeg fallback, verify this command in the same terminal before starting Vite:

```bash
ffmpeg -version
```


## Smooth export (v1.2)

This build defaults to 60 FPS. It records the canvas as WebM, then FFmpeg converts it to H.264/AAC MP4 at a forced constant frame rate (CFR). This avoids the uneven frame pacing seen in direct browser MP4 recording. Keep the visualizer tab visible during the real-time recording stage because browsers can throttle animation in background tabs.


## Smooth-render optimization (v1.3)

The static 1080p background, cover, blur and metadata are now cached and only rebuilt when you edit them. During playback/export the app redraws only the audio-reactive visualizer and progress bar. Spectrum bars are also batched into one glow/fill pass instead of one shadow pass per bar. This greatly reduces dropped source frames during 60 FPS browser capture.
