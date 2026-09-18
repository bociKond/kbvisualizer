import { defineConfig, type Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

function runFfmpeg(input: string, output: string, fps: 30 | 60) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', input,
      '-vf', `fps=${fps}`,
      '-fps_mode', 'cfr',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '320k',
      '-movflags', '+faststart',
      output
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function mp4ExportPlugin(): Plugin {
  return {
    name: 'mp4-export-plugin',
    configureServer(server) {
      server.middlewares.use('/api/convert', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        const folder = await mkdtemp(join(tmpdir(), 'beat-visualizer-'));
        const input = join(folder, 'capture.webm');
        const output = join(folder, 'visualizer.mp4');

        try {
          // Stream the upload straight to disk instead of buffering the whole video in RAM.
          await pipeline(req, createWriteStream(input));
          const url = new URL(req.url ?? '', 'http://localhost');
          const fps: 30 | 60 = url.searchParams.get('fps') === '30' ? 30 : 60;
          await runFfmpeg(input, output, fps);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Disposition', 'attachment; filename="beat-visualizer.mp4"');

          const stream = createReadStream(output);
          stream.on('error', (error) => res.destroy(error));
          stream.on('close', () => {
            void rm(folder, { recursive: true, force: true });
          });
          stream.pipe(res);
        } catch (error) {
          await rm(folder, { recursive: true, force: true });
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          const message = error instanceof Error ? error.message : String(error);
          res.end(`Export failed. Make sure FFmpeg is installed and available in PATH.\n\n${message}`);
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [mp4ExportPlugin()]
});
