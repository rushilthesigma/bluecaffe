import { api } from './api';
import { useStore } from './state/store';
import type { Clip } from './types';

const MIN_DUR = 0.2;

// The full set of look/trim fields a clone should carry forward, so a duplicated
// or split clip looks identical to its source instead of resetting to defaults.
function lookOf(clip: Clip): Partial<Clip> {
  return {
    inPoint: clip.inPoint,
    duration: clip.duration,
    opacity: clip.opacity,
    x: clip.x, y: clip.y, scale: clip.scale,
    fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
    hue: clip.hue, brightness: clip.brightness,
    saturation: clip.saturation, contrast: clip.contrast,
    temperature: clip.temperature, filter: clip.filter,
    loop: clip.loop,
    muted: clip.muted,
    audioOnly: clip.audioOnly,
    volume: clip.volume,
    text: clip.text, fontSize: clip.fontSize, fontColor: clip.fontColor,
    align: clip.align, fontWeight: clip.fontWeight, fontFamily: clip.fontFamily,
  };
}

// Drop a copy of the clip flush after it (the server ripples the lane so it never
// overlaps). Returns the new clip id and selects it. `start` lets the timeline
// pass a snapped position; otherwise it lands right after the original.
export async function duplicateClip(clip: Clip, start = clip.start + clip.duration): Promise<string> {
  const { clip: nc } = await api.addClip({
    assetId: clip.assetId,
    trackId: clip.trackId,
    start,
    duration: clip.duration,
  });
  await api.patchClip(nc.id, lookOf(clip));
  useStore.getState().select(nc.id);
  return nc.id;
}

// Cut the clip in two at `at` (frame time on the timeline): shrink the left half
// in place, spawn the right half carrying the trim + look forward. No-op when the
// cut would leave either half shorter than the minimum duration.
export async function splitClip(clip: Clip, at: number): Promise<void> {
  const leftDur = at - clip.start;
  const rightDur = clip.start + clip.duration - at;
  if (leftDur < MIN_DUR || rightDur < MIN_DUR) return;
  await api.patchClip(clip.id, { duration: leftDur });
  const { clip: nc } = await api.addClip({
    assetId: clip.assetId,
    trackId: clip.trackId,
    start: at,
    duration: rightDur,
  });
  await api.patchClip(nc.id, {
    ...lookOf(clip),
    inPoint: clip.inPoint + leftDur,
    duration: rightDur,
    fadeIn: 0, // the new entry edge starts hard, the original keeps its fade-out
  });
}

function audioTrackId() {
  const st = useStore.getState();
  const byKind = st.project.tracks.find((t) => t.kind === 'audio');
  if (byKind) return byKind.id;
  const byName = st.project.tracks.find((t) => /^A\d+/i.test(t.name || ''));
  return byName?.id ?? null;
}

// Separate a video's sound from its picture. The video clip remains in place but
// is muted, and an audio-only clip with matching trim lands on an audio lane.
export async function splitAudioAndVideo(clip: Clip): Promise<string | null> {
  const st = useStore.getState();
  const asset = st.assets.find((a) => a.id === clip.assetId);
  if (!asset || asset.kind !== 'video' || clip.muted) return null;

  const { asset: audioAsset } = await api.deriveAudioAsset(asset.id, { name: `${clip.name} Audio` });
  let trackId = audioTrackId();
  if (!trackId) {
    const { track } = await api.addTrack({ kind: 'audio' });
    trackId = track.id;
  }

  useStore.getState().patchClipLocal(clip.id, { muted: true });
  await api.patchClip(clip.id, { muted: true });
  const { clip: audioClip } = await api.addClip({
    assetId: audioAsset.id,
    trackId,
    start: clip.start,
    duration: clip.duration,
  });
  const patch: Partial<Clip> = {
    inPoint: clip.inPoint,
    duration: clip.duration,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    loop: clip.loop,
    muted: false,
    audioOnly: true,
    volume: clip.volume ?? 1,
  };
  await api.patchClip(audioClip.id, patch);
  useStore.getState().upsertClipLocal({ ...audioClip, ...patch });
  useStore.getState().select(audioClip.id);
  return audioClip.id;
}

// Remove the clip and clear the selection if it was the one selected.
export async function removeClip(clip: Clip): Promise<void> {
  await api.deleteClip(clip.id);
  if (useStore.getState().selectedClipId === clip.id) useStore.getState().select(null);
}
