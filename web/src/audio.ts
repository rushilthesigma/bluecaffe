import type { Asset, Clip } from './types';

// Plays sound for audio + video clips, kept in lockstep with the timeline playhead.
// Decoupled from the WebGPU renderer: it owns its own HTMLAudioElement per asset
// (a video's muted <video> handles the picture, this handles the sound).
export interface AudioEngine {
  sync(clips: Clip[], assets: Asset[], playhead: number, playing: boolean): void;
  dispose(): void;
}

const DRIFT = 0.3; // seconds of slip before we re-seek a playing element

export function createAudioEngine(): AudioEngine {
  const els = new Map<string, HTMLAudioElement>();

  const ensure = (assetId: string, url: string) => {
    let el = els.get(assetId);
    if (!el) {
      el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.src = url;
      els.set(assetId, el);
    }
    return el;
  };

  // fade-in/out envelope as a volume gain (visual opacity does not affect sound)
  const gainFor = (c: Clip, playhead: number) => {
    const local = playhead - c.start;
    const remaining = c.start + c.duration - playhead;
    let g = 1;
    if (c.fadeIn > 0 && local < c.fadeIn) g *= Math.max(0, local / c.fadeIn);
    if (c.fadeOut > 0 && remaining < c.fadeOut) g *= Math.max(0, remaining / c.fadeOut);
    return Math.max(0, Math.min(1, g));
  };

  function sync(clips: Clip[], assets: Asset[], playhead: number, playing: boolean) {
    const byId = new Map(assets.map((a) => [a.id, a]));
    const active = new Set<string>();

    for (const c of clips) {
      const a = byId.get(c.assetId);
      if (!a || c.muted || (a.kind !== 'audio' && a.kind !== 'video')) continue;
      const url = c.src ?? a.url;
      if (!url) continue;
      if (playhead < c.start || playhead >= c.start + c.duration) continue;

      active.add(c.assetId);
      const el = ensure(c.assetId, url);
      // a looping clip wraps its source within the trimmed [inPoint, sourceDuration] window
      const local = playhead - c.start;
      const period = c.sourceDuration - c.inPoint;
      const target = c.loop && period > 0.05 ? c.inPoint + (local % period) : local + c.inPoint;
      el.volume = gainFor(c, playhead) * Math.max(0, Math.min(2, c.volume ?? 1));

      if (playing) {
        if (el.paused) {
          try { el.currentTime = target; } catch { /* not seekable yet */ }
          el.play().catch(() => { /* needs a user gesture; ignored */ });
        } else if (Math.abs(el.currentTime - target) > DRIFT) {
          try { el.currentTime = target; } catch { /* not seekable yet */ }
        }
      } else if (!el.paused) {
        el.pause();
      }
    }

    // silence anything no longer under the playhead (or while paused/scrubbing)
    for (const [id, el] of els) {
      if ((!active.has(id) || !playing) && !el.paused) el.pause();
    }
  }

  function dispose() {
    for (const el of els.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    els.clear();
  }

  return { sync, dispose };
}
