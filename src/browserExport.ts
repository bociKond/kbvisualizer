import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  canEncodeVideo
} from 'mediabunny';

import { registerAacEncoder } from '@mediabunny/aac-encoder';

export interface BrowserRenderOptions {
  canvas: HTMLCanvasElement;
  audioBuffer: AudioBuffer;
  fps: 30 | 60 | number;
  videoBitrate?: number;
  audioBitrate?: number;
  drawFrame: (time: number, frameNumber: number) => void | Promise<void>;
  onProgress?: (progress: number) => void;
}

let fallbackRegistered = false;

async function prepareAAC(audioBuffer: AudioBuffer, requestedBitrate: number) {
  const channels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels));
  const sampleRate = 48_000;
  const bitrates = [requestedBitrate, 192_000, 160_000, 128_000];

  for (const bitrate of bitrates) {
    const quality = new Quality({ bitrate });
    const supported = await canEncodeAudio('aac', {
      numberOfChannels: channels,
      sampleRate,
      quality
    });

    if (supported) {
      return { bitrate, channels, sampleRate, quality };
    }
  }

  if (!fallbackRegistered) {
    registerAacEncoder();
    fallbackRegistered = true;
  }

  for (const bitrate of bitrates) {
    const quality = new Quality({ bitrate });
    const supported = await canEncodeAudio('aac', {
      numberOfChannels: channels,
      sampleRate,
      quality
    });

    if (supported) {
      return { bitrate, channels, sampleRate, quality };
    }
  }

  throw new Error('AAC encoding is not supported on this device, even with the fallback encoder.');
}

export async function renderMP4({
  canvas,
  audioBuffer,
  fps,
  videoBitrate = fps >= 60 ? 12_000_000 : 8_000_000,
  audioBitrate = 192_000,
  drawFrame,
  onProgress
}: BrowserRenderOptions): Promise<Blob> {
  if (!('VideoEncoder' in window)) {
    throw new Error('This browser does not support WebCodecs video encoding. Try a current Chrome or Edge browser.');
  }

  const videoQuality = new Quality({ bitrate: videoBitrate });

  const canEncodeH264 = await canEncodeVideo('avc', {
    width: canvas.width,
    height: canvas.height,
    frameRate: fps,
    quality: videoQuality
  });

  if (!canEncodeH264) {
    throw new Error(`This device cannot encode ${canvas.width}×${canvas.height} H.264 at ${fps} FPS.`);
  }

  const audioConfig = await prepareAAC(audioBuffer, audioBitrate);

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target
  });

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    quality: videoQuality
  });

  const audioSource = new AudioBufferSource({
    codec: 'aac',
    quality: audioConfig.quality,
    transform: {
      numberOfChannels: audioConfig.channels,
      sampleRate: audioConfig.sampleRate
    }
  });

  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);

  let started = false;

  try {
    await output.start();
    started = true;

    const audioPromise = audioSource.add(audioBuffer).then(() => {
      audioSource.close();
    });

    const duration = audioBuffer.duration;
    const frameDuration = 1 / fps;
    const totalFrames = Math.ceil(duration * fps);

    for (let frame = 0; frame < totalFrames; frame++) {
      const timestamp = frame * frameDuration;
      const remaining = duration - timestamp;
      if (remaining <= 0) break;

      await drawFrame(timestamp, frame);

      await videoSource.add(
        timestamp,
        Math.min(frameDuration, remaining),
        { keyFrame: frame % Math.max(1, Math.round(fps * 2)) === 0 }
      );

      if (frame % 10 === 0 || frame === totalFrames - 1) {
        onProgress?.((frame + 1) / totalFrames);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    videoSource.close();
    await audioPromise;
    await output.finalize();

    if (!target.buffer) {
      throw new Error('MP4 encoding completed but no output buffer was produced.');
    }

    onProgress?.(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    if (started && output.state !== 'finalized' && output.state !== 'canceled') {
      try {
        await output.cancel();
      } catch {
        // Keep the original render error.
      }
    }
    throw error;
  }
}
