import type { Clip, Asset } from './types';

export async function mixAudio(clips: Clip[], assets: Asset[], duration: number): Promise<Uint8Array | null> {
  const byId = new Map(assets.map((a) => [a.id, a]));

  const audioClips = clips.filter((c) => {
    if (c.muted) return false;
    const a = byId.get(c.assetId);
    if (!a) return false;
    const url = c.src ?? a.url;
    if (!url) return false;
    return a.kind === 'audio' || a.kind === 'video';
  });

  if (audioClips.length === 0) return null;

  const sampleRate = 44100;
  const totalSamples = Math.max(1, Math.ceil(duration * sampleRate));
  const offline = new OfflineAudioContext(2, totalSamples, sampleRate);

  await Promise.all(
    audioClips.map(async (clip) => {
      const a = byId.get(clip.assetId)!;
      const url = clip.src ?? a.url!;
      try {
        const resp = await fetch(url);
        const raw = await resp.arrayBuffer();
        const decoded = await offline.decodeAudioData(raw);

        const src = offline.createBufferSource();
        src.buffer = decoded;

        const vol = Math.max(0, Math.min(2, clip.volume ?? 1));
        const gain = offline.createGain();
        gain.gain.setValueAtTime(vol, 0);

        if (clip.fadeIn > 0) {
          gain.gain.setValueAtTime(0, clip.start);
          gain.gain.linearRampToValueAtTime(vol, clip.start + clip.fadeIn);
        }
        if (clip.fadeOut > 0) {
          const fadeStart = clip.start + clip.duration - clip.fadeOut;
          gain.gain.setValueAtTime(vol, Math.max(0, fadeStart));
          gain.gain.linearRampToValueAtTime(0, clip.start + clip.duration);
        }

        src.connect(gain);
        gain.connect(offline.destination);
        src.start(clip.start, clip.inPoint, clip.duration);
      } catch (e) {
        console.warn('[export] audio decode failed for clip', clip.id, e);
      }
    }),
  );

  const rendered = await offline.startRendering();
  return encodeWAV(rendered);
}

function encodeWAV(buf: AudioBuffer): Uint8Array {
  const numCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const n = buf.length;
  const blockAlign = numCh * 2;
  const dataSize = n * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const v = new DataView(out);
  const s = (off: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };

  s(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); s(8, 'WAVE');
  s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, dataSize, true);

  const channels = Array.from({ length: numCh }, (_, i) => buf.getChannelData(i));
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      v.setInt16(off, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      off += 2;
    }
  }
  return new Uint8Array(out);
}
