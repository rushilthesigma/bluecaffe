// Pure helpers for the clip keyframe system, shared by the render loop
// (Preview), the property editor (Inspector), the on-stage drag overlay, and the
// timeline markers — so every surface evaluates and edits keyframes identically.
import type { Clip, Keyframe, KeyableProp, EaseKind } from './types';

// The transform properties the UI exposes for keyframing, with their slider
// bounds and the static-field default each falls back to.
export interface KeyableMeta {
  prop: KeyableProp;
  label: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  unit?: string;
}

export const KEYABLE: KeyableMeta[] = [
  { prop: 'scale',   label: 'Scale',    min: 0.1, max: 2, step: 0.01, fallback: 1 },
  { prop: 'x',       label: 'Offset X', min: -1,  max: 1, step: 0.01, fallback: 0 },
  { prop: 'y',       label: 'Offset Y', min: -1,  max: 1, step: 0.01, fallback: 0 },
  { prop: 'opacity', label: 'Opacity',  min: 0,   max: 1, step: 0.01, fallback: 1 },
];

export const KEYABLE_FILTERS: KeyableMeta[] = [
  { prop: 'brightness', label: 'Brightness', min: 0,  max: 2,   step: 0.01, fallback: 1 },
  { prop: 'saturation', label: 'Saturation', min: 0,  max: 2,   step: 0.01, fallback: 1 },
  { prop: 'contrast',   label: 'Contrast',   min: 0,  max: 2,   step: 0.01, fallback: 1 },
  { prop: 'temperature',label: 'Warmth',     min: -1, max: 1,   step: 0.01, fallback: 0 },
  { prop: 'hue',        label: 'Hue',        min: 0,  max: 360, step: 1,    fallback: 0 },
];

export function newKeyframeId(): string {
  return `kf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Keyframes for one property, time-sorted.
export function kfFor(clip: Clip, prop: KeyableProp): Keyframe[] {
  return (clip.keyframes ?? []).filter((k) => k.prop === prop).sort((a, b) => a.t - b.t);
}

export function isAnimated(clip: Clip, prop: KeyableProp): boolean {
  return (clip.keyframes ?? []).some((k) => k.prop === prop);
}

function easeFn(e: EaseKind, t: number): number {
  if (e === 'hold') return 0;
  if (e === 'linear') return t;
  if (e === 'ease-in') return t * t * t;
  if (e === 'ease-out') return 1 - Math.pow(1 - t, 3);
  return t * t * (3 - 2 * t);            // 'ease': smoothstep (default)
}

// Value of a property at `local` (seconds from clip start). Falls back to the
// clip's static field when the property has no keyframes; clamps flat past the
// first/last key so motion holds at the ends rather than extrapolating.
export function evalProp(clip: Clip, prop: KeyableProp, local: number, fallback: number): number {
  const ks = kfFor(clip, prop);
  if (ks.length === 0) {
    const v = clip[prop];
    return typeof v === 'number' ? v : fallback;
  }
  if (local <= ks[0].t) return ks[0].value;
  const last = ks[ks.length - 1];
  if (local >= last.t) return last.value;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (local >= a.t && local <= b.t) {
      const span = b.t - a.t;
      const f = span <= 1e-6 ? 1 : (local - a.t) / span;
      return a.value + (b.value - a.value) * easeFn(a.ease ?? 'ease', f);
    }
  }
  return last.value;
}

// The keyframe sitting at (within eps of) the given time, or null.
export function keyframeAt(clip: Clip, prop: KeyableProp, local: number, eps: number): Keyframe | null {
  return kfFor(clip, prop).find((k) => Math.abs(k.t - local) <= eps) ?? null;
}

// Add a keyframe at `local`, or update the value of one already there. Returns a
// fresh keyframes array (other properties untouched).
export function upsertKeyframe(clip: Clip, prop: KeyableProp, local: number, value: number, eps: number): Keyframe[] {
  const all = (clip.keyframes ?? []).slice();
  const t = Math.max(0, local);
  const existing = all.find((k) => k.prop === prop && Math.abs(k.t - t) <= eps);
  if (existing) return all.map((k) => (k === existing ? { ...k, value } : k));
  all.push({ id: newKeyframeId(), prop, t, value, ease: 'ease' });
  return all;
}

export function removeKeyframe(clip: Clip, id: string): Keyframe[] {
  return (clip.keyframes ?? []).filter((k) => k.id !== id);
}

export function setKeyframeEase(clip: Clip, id: string, ease: EaseKind): Keyframe[] {
  return (clip.keyframes ?? []).map((k) => (k.id === id ? { ...k, ease } : k));
}

// Time of the nearest keyframe strictly before / after `local` for a property,
// for the prev/next jump buttons. Returns null when there is none in that
// direction.
export function adjacentKeyframeTime(clip: Clip, prop: KeyableProp, local: number, dir: -1 | 1, eps: number): number | null {
  const ks = kfFor(clip, prop);
  if (dir < 0) {
    let best: number | null = null;
    for (const k of ks) if (k.t < local - eps) best = k.t;
    return best;
  }
  for (const k of ks) if (k.t > local + eps) return k.t;
  return null;
}

// Distinct keyframe times across all properties (for the timeline markers and
// the inspector mini-track), time-sorted.
export function keyframeTimes(clip: Clip): number[] {
  const ks = clip.keyframes ?? [];
  if (ks.length === 0) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const k of ks.slice().sort((a, b) => a.t - b.t)) {
    const q = Math.round(k.t * 1000) / 1000;
    if (!seen.has(q)) { seen.add(q); out.push(k.t); }
  }
  return out;
}
