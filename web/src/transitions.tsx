import { isCrossKind, isPushKind } from './types';
import type { TransitionKind } from './types';
export { isCrossKind, isPushKind };

// The transition library, Filmora-style: a small set of push slides you drag
// from the Media panel onto a clip. Each one maps to the clip's transIn/transOut
// push fields the compositor already animates.
export interface TransPreset {
  kind: Exclude<TransitionKind, 'none'>;
  label: string; // gallery name, e.g. "Push Left"
  short: string;  // compact label, e.g. "Left"
}

export const PUSH_TRANSITIONS: TransPreset[] = [
  { kind: 'push-left', label: 'Push Left', short: 'Left' },
  { kind: 'push-right', label: 'Push Right', short: 'Right' },
  { kind: 'push-up', label: 'Push Up', short: 'Up' },
  { kind: 'push-down', label: 'Push Down', short: 'Down' },
  { kind: 'push-tl', label: 'Push Top-Left', short: 'Top-L' },
  { kind: 'push-tr', label: 'Push Top-Right', short: 'Top-R' },
  { kind: 'push-bl', label: 'Push Bot-Left', short: 'Bot-L' },
  { kind: 'push-br', label: 'Push Bot-Right', short: 'Bot-R' },
];

// Opacity-based transitions. A 'fade' rides the dark stage (a dip to black
// between two clips); a 'dissolve' cross-blends with the neighbouring clip.
export const CROSS_TRANSITIONS: TransPreset[] = [
  { kind: 'fade', label: 'Fade', short: 'Fade' },
  { kind: 'dissolve', label: 'Dissolve', short: 'Dissolve' },
];

// Scale and rotation effects applied to the clip itself.
export const EFFECT_TRANSITIONS: TransPreset[] = [
  { kind: 'zoom-in', label: 'Zoom In', short: 'Zoom↑' },
  { kind: 'zoom-out', label: 'Zoom Out', short: 'Zoom↓' },
  { kind: 'spin', label: 'Spin', short: 'Spin' },
];

// The full gallery: opacity blends first (most-used), then directional pushes, then effects.
export const ALL_TRANSITIONS: TransPreset[] = [...CROSS_TRANSITIONS, ...PUSH_TRANSITIONS, ...EFFECT_TRANSITIONS];

// Human label for any kind, including 'none', for menus and tooltips.
export function transLabel(kind: TransitionKind): string {
  if (kind === 'none') return 'None';
  return ALL_TRANSITIONS.find((t) => t.kind === kind)?.label ?? kind.replace('-', ' ');
}

// drag payload type + default length applied on drop (Filmora defaults to 2s,
// but our clips are short, so a snappier default reads better)
export const TRANS_DND_TYPE = 'application/x-deckstop-transition';
export const DEFAULT_TRANS_DUR = 0.6;

// degrees to rotate the up-arrow glyph so it points the way the picture travels
export function pushRotation(kind: TransitionKind): number {
  if (kind === 'push-up') return 0;
  if (kind === 'push-tr') return 45;
  if (kind === 'push-right') return 90;
  if (kind === 'push-br') return 135;
  if (kind === 'push-down') return 180;
  if (kind === 'push-bl') return 225;
  if (kind === 'push-tl') return 315;
  return 270; // push-left default
}

// arrow glyph pointing in the clip's travel direction; shared by the library
// tiles, the on-clip badges, and the duration popover.
export function PushIcon({ kind, size = 14 }: { kind: TransitionKind; size?: number }) {
  return (
    <svg
      className="push-ico"
      viewBox="0 0 14 14"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ transform: `rotate(${pushRotation(kind)}deg)` }}
    >
      <path d="M7 2.5 L7 11.5 M7 2.5 L3.4 6.1 M7 2.5 L10.6 6.1" />
    </svg>
  );
}

// fade glyph: a wedge ramping from clear to solid (opacity over time).
function FadeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="trans-ico" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="ds-fade-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d="M1 12 L13 2 L13 12 Z" fill="url(#ds-fade-g)" stroke="none" />
    </svg>
  );
}

// dissolve glyph: two overlapping rounded squares blending into each other.
function DissolveIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="trans-ico" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="3.5" width="7" height="7" rx="1.4" opacity="0.55" />
      <rect x="5.5" y="3.5" width="7" height="7" rx="1.4" />
    </svg>
  );
}

// zoom-in glyph: small square growing outward
function ZoomInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="trans-ico" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <rect x="4" y="4" width="6" height="6" rx="0.8" opacity="0.45" />
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
      <path d="M7 4.2V9.8M4.2 7h5.6" />
    </svg>
  );
}

// zoom-out glyph: large square shrinking inward
function ZoomOutIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="trans-ico" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
      <rect x="4" y="4" width="6" height="6" rx="0.8" opacity="0.45" />
      <path d="M4.2 7h5.6" />
    </svg>
  );
}

// spin glyph: circular arrow
function SpinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="trans-ico" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M11.5 7a4.5 4.5 0 1 1-1.8-3.6" />
      <path d="M9 2l2.5 1.4L10 6" />
    </svg>
  );
}

// the right glyph for any transition kind — pushes get the arrow, blends their
// own mark. Used everywhere a transition is shown (gallery, badges, popovers).
export function TransIcon({ kind, size = 14 }: { kind: TransitionKind; size?: number }) {
  if (kind === 'fade') return <FadeIcon size={size} />;
  if (kind === 'dissolve') return <DissolveIcon size={size} />;
  if (kind === 'zoom-in') return <ZoomInIcon size={size} />;
  if (kind === 'zoom-out') return <ZoomOutIcon size={size} />;
  if (kind === 'spin') return <SpinIcon size={size} />;
  return <PushIcon kind={kind} size={size} />;
}
