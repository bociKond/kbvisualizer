KBVisualizer browser-only MP4 export patch
===========================================

What this changes
-----------------
- Removes the need for /api/convert and local/server FFmpeg.
- Renders deterministic H.264 + AAC MP4 directly in the browser.
- Works when the Netlify site is opened on another device, including a phone.
- Keeps your live AnalyserNode preview.
- Uses a deterministic FFT-based spectrum during export so the exported bars do not depend on real-time playback/render speed.
- Defaults to 1080p30 for mobile friendliness; 1080p60 remains selectable.

1) Install dependencies
-----------------------
From D:\Sites\visualizer run:

npm install mediabunny @mediabunny/aac-encoder

2) Replace/add files
--------------------
Replace:
  src/main.ts

Add:
  src/browserExport.ts

Use the files in this patch's src folder.

3) Test locally
---------------
npm run dev

Load a beat and cover, then try Export MP4.
No local FFmpeg server should be needed.

4) Production build
-------------------
npm run build

5) Push to GitHub
-----------------
git add .
git commit -m "Move MP4 rendering into browser"
git push

Netlify should automatically redeploy from main.

Notes
-----
- The MP4 is encoded on the device opening the site, not on Netlify.
- 1080p60 is much heavier than 1080p30 on a phone. If Chrome runs out of memory or the device gets too hot, use 30 FPS.
- The code uses Mediabunny's AAC fallback package when the browser does not provide native AAC encoding.
- The final MP4 is held in browser memory until the Download MP4 link is created, so very long/high-bitrate videos can still be memory-heavy.
