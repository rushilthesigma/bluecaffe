export type AgentKind = 'claude' | 'codex' | 'human';
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'offline';
export type TaskStatus = 'backlog' | 'queued' | 'in_progress' | 'review' | 'done' | 'blocked';
export type Priority = 'low' | 'med' | 'high';

// A clip can slide into place on entry and slide off on exit. The direction is
// the way the picture travels: 'push-up' enters from below moving up, etc.
// 'fade' and 'dissolve' instead ramp opacity rather than position: a 'fade'
// goes through the dark stage (dip to black between two clips), a 'dissolve'
// cross-blends with the neighbouring clip across the cut.
export type TransitionKind =
  | 'none'
  | 'push-up' | 'push-down' | 'push-left' | 'push-right'
  | 'push-tl' | 'push-tr' | 'push-bl' | 'push-br'
  | 'fade' | 'dissolve'
  | 'zoom-in' | 'zoom-out' | 'spin';

// Transitions that ramp opacity instead of pushing the picture around. Shared by
// the compositor, the inspector, and the timeline so all surfaces agree.
export const CROSS_KINDS = ['fade', 'dissolve'] as const;
export function isCrossKind(k: TransitionKind | undefined): boolean {
  return k === 'fade' || k === 'dissolve';
}
export function isPushKind(k: TransitionKind | undefined): boolean {
  return k === 'push-up' || k === 'push-down' || k === 'push-left' || k === 'push-right'
    || k === 'push-tl' || k === 'push-tr' || k === 'push-bl' || k === 'push-br';
}

// Properties that can vary over a clip's life via keyframes. These map directly
// to the transform and color-grade fields the compositor reads per frame.
export type KeyableProp = 'opacity' | 'scale' | 'x' | 'y' | 'hue' | 'brightness' | 'saturation' | 'contrast' | 'temperature';
// How a value travels from one keyframe to the next. 'ease' = smooth in+out (default),
// 'ease-in' = accelerate, 'ease-out' = decelerate, 'linear' = constant speed,
// 'hold' = step (jump at the next key).
export type EaseKind = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bounce' | 'elastic' | 'back' | 'hold';

// A single keyframe: a property reaches `value` at time `t` (seconds, measured
// from the clip's start so keys ride along when the clip is moved/trimmed). The
// ease governs the segment to the NEXT keyframe.
export interface Keyframe {
  id: string;
  prop: KeyableProp;
  t: number;
  value: number;
  ease?: EaseKind;
}

export interface Track {
  id: string;
  name: string;
  index: number;
  kind?: 'video' | 'audio';
}

export interface Asset {
  id: string;
  name: string;
  kind: 'procedural' | 'image' | 'video' | 'audio' | 'text';
  hue?: number;
  color?: string;
  url?: string;
  duration: number;
  width?: number | null;
  height?: number | null;
  text?: string; // default content for text assets
  sourceAssetId?: string;
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  name: string;
  start: number;
  duration: number;
  inPoint: number;
  sourceDuration: number;
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation?: number; // degrees, clockwise; optional so older clips load cleanly
  fadeIn: number;
  fadeOut: number;
  // slide transitions: push the clip into place as it begins and off as it ends.
  // optional so clips persisted before this feature still load cleanly.
  transIn?: TransitionKind;
  transInDur?: number;   // seconds the entry push lasts
  transInEase?: EaseKind;
  transOut?: TransitionKind;
  transOutDur?: number;  // seconds the exit push lasts
  transOutEase?: EaseKind;
  loop: boolean; // when on, the source repeats to fill a duration longer than itself
  hue: number;
  brightness: number;
  // color grade / filters
  saturation: number; // 0 = grayscale, 1 = unchanged, 2 = punchy
  contrast: number;   // 1 = unchanged, <1 flat, >1 crunchy
  temperature: number; // -1 cool .. 0 neutral .. +1 warm
  filter: string;     // preset key driving the grade (UI label only)
  color: string;
  src?: string | null;
  // text clips (kind === 'text' asset): rendered as an overlay layer
  text?: string;
  fontSize?: number;   // px at the project's authoring resolution
  fontColor?: string;  // hex
  align?: 'left' | 'center' | 'right';
  fontWeight?: number; // 400 = regular, 700 = bold
  fontFamily?: string; // id from fonts.ts (e.g. 'inter'); undefined = system
  muted?: boolean;
  audioOnly?: boolean;
  volume?: number;
  // per-property animation; absent or empty means the static fields above hold
  // for the clip's whole life.
  keyframes?: Keyframe[];
  // visual post-effects (0 = off, 0..1 = strength)
  blur?: number;
  vignette?: number;
  grain?: number;
  pixelate?: number;
}

export interface Project {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  tracks: Track[];
}

export interface ProjectPoster {
  playhead: number;
  tracks: Track[];
  clips: Clip[];
  assets: Asset[];
}

// Lightweight per-project summary the server sends for the project switcher.
export interface ProjectSummary {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  clipCount: number;
  trackCount: number;
  createdAt?: string;
  updatedAt?: string;
  poster?: ProjectPoster | null;
}

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  role: string;
  status: AgentStatus;
  color: string;
  isHead: boolean;
}

export interface Task {
  id: string;
  title: string;
  detail: string;
  assigneeId: string | null;
  status: TaskStatus;
  priority: Priority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  rev: number;
  project: Project;
  assets: Asset[];
  clips: Clip[];
  agents: Agent[];
  tasks: Task[];
  projects?: ProjectSummary[];
  currentProjectId?: string;
}
