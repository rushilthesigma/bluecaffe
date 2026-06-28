import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { createCanvas2DCompositor } from './webgpu/renderer';
import { buildLayers } from './components/Preview';
import { mixAudio } from './audioMix';
import type { Project, Clip, Asset, Track } from './types';

export type ExportPhase = 'rendering' | 'audio' | 'encoding' | 'muxing' | 'done';

export interface ExportProgress {
  phase: ExportPhase;
  pct: number; // 0..1
  frame?: number;
  totalFrames?: number;
}

const AUDIO_SAMPLE_RATE = 44100;
const AUDIO_CHANNELS = 2;

function hasAudioContent(clips: Clip[], assets: Asset[]): boolean {
  return clips.some((c) => {
    if (c.muted) return false;
    const a = assets.find((x) => x.id === c.assetId);
    return a?.kind === 'audio' || a?.kind === 'video';
  });
}

export async function exportMp4(
  project: Project,
  clips: Clip[],
  assets: Asset[],
  tracks: Track[],
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const { width, height, fps } = project;
  const contentEnd = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  if (contentEnd <= 0) throw new Error('Nothing on the timeline to export.');

  const totalFrames = Math.ceil(contentEnd * fps);
  const frameDurationUs = Math.round(1_000_000 / fps);

  const withAudio = hasAudioContent(clips, assets) && typeof AudioEncoder !== 'undefined';

  // Check H.264 support
  const videoConfig: VideoEncoderConfig = {
    codec: 'avc1.42001f',
    width,
    height,
    bitrate: Math.round(width * height * fps * 0.1),
    framerate: fps,
    latencyMode: 'quality',
  };
  const support = await VideoEncoder.isConfigSupported(videoConfig);
  if (!support.supported) throw new Error('H.264 encoding not supported in this browser.');

  // Build muxer – audio config must be declared at construction
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    ...(withAudio
      ? { audio: { codec: 'aac', numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_SAMPLE_RATE } }
      : {}),
    fastStart: 'in-memory',
  });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  videoEncoder.configure(videoConfig);

  // Dedicated full-res canvas – never tainted because uploads come from same origin
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const compositor = createCanvas2DCompositor(canvas);

  try {
    // ── Phase 1: render video frames ────────────────────────────────────────
    onProgress({ phase: 'rendering', pct: 0, frame: 0, totalFrames });

    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

      const t = f / fps;
      const layers = buildLayers(clips, tracks, assets, t, width, height);
      if (compositor.seekAll) await compositor.seekAll(layers);
      compositor.render(layers, false);

      const ts = f * frameDurationUs;
      const vf = new VideoFrame(canvas, { timestamp: ts, duration: frameDurationUs });
      videoEncoder.encode(vf, { keyFrame: f % (fps * 2) === 0 });
      vf.close();

      onProgress({ phase: 'rendering', pct: ((f + 1) / totalFrames) * (withAudio ? 0.65 : 0.85), frame: f + 1, totalFrames });
    }
    await videoEncoder.flush();
    videoEncoder.close();

    // ── Phase 2 + 3: mix and encode audio ───────────────────────────────────
    if (withAudio) {
      onProgress({ phase: 'audio', pct: 0.65 });
      const wavData = await mixAudio(clips, assets, contentEnd);
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

      if (wavData) {
        onProgress({ phase: 'encoding', pct: 0.75 });
        const ctx = new AudioContext();
        const rawBuf = wavData.buffer.slice(0) as ArrayBuffer;
        const audioBuf = await ctx.decodeAudioData(rawBuf);
        ctx.close();

        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => { throw e; },
        });
        audioEncoder.configure({
          codec: 'mp4a.40.2',
          sampleRate: AUDIO_SAMPLE_RATE,
          numberOfChannels: AUDIO_CHANNELS,
          bitrate: 192_000,
        });

        const chunkFrames = Math.round(AUDIO_SAMPLE_RATE * 0.1);
        const total = audioBuf.length;
        let offset = 0;
        while (offset < total) {
          if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
          const size = Math.min(chunkFrames, total - offset);
          const ad = new AudioData({
            format: 'f32-planar',
            sampleRate: AUDIO_SAMPLE_RATE,
            numberOfFrames: size,
            numberOfChannels: AUDIO_CHANNELS,
            timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1_000_000),
            data: extractF32Planar(audioBuf, offset, size),
          });
          audioEncoder.encode(ad);
          ad.close();
          offset += size;
        }
        await audioEncoder.flush();
        audioEncoder.close();
      }
    }

    // ── Phase 4: finalize ────────────────────────────────────────────────────
    onProgress({ phase: 'muxing', pct: 0.92 });
    muxer.finalize();
    const { buffer } = muxer.target as ArrayBufferTarget;

    onProgress({ phase: 'done', pct: 1 });
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    compositor.dispose();
  }
}

function extractF32Planar(buf: AudioBuffer, offset: number, length: number): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const out = new Float32Array(ch * length);
  for (let i = 0; i < ch; i++) {
    out.set(buf.getChannelData(i).subarray(offset, offset + length), i * length);
  }
  return out.buffer as ArrayBuffer;
}
