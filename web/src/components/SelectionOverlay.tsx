import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { evalProp, isAnimated, upsertKeyframe } from '../keyframes';
import { fontStack } from '../fonts';
import { fitExtents } from '../aspect';
import type { Clip } from '../types';

// The clip's transform at the current playhead: keyframes (if any) win over the
// static fields, so the selection box and drag math sit on the rendered picture.
function xform(c: Clip): { x: number; y: number; scale: number } {
  const local = useStore.getState().playhead - c.start;
  return {
    x: evalProp(c, 'x', local, c.x),
    y: evalProp(c, 'y', local, c.y),
    scale: evalProp(c, 'scale', local, c.scale),
  };
}

// The canvas's displayed rect in CSS px, measured relative to the preview stage.
export interface CanvasBox {
  left: number;
  top: number;
  w: number;
  h: number;
}

// Contain-fit half-extents for a picture clip, mirroring Preview.buildLayers so
// the selection box hugs the actual (non-stretched) picture. Non-picture clips
// fill the frame on both axes.
function aspectOf(c: Clip): { ax: number; ay: number } {
  const st = useStore.getState();
  const a = st.assets.find((x) => x.id === c.assetId);
  const kind = a?.kind ?? (c.src ? 'image' : 'procedural');
  if (kind !== 'image' && kind !== 'video') return { ax: 1, ay: 1 };
  return fitExtents(a?.width, a?.height, st.project.width, st.project.height);
}

// Box of a clip in stage-local CSS px. A picture fills `scale` of the canvas on
// its long axis and `scale · aspect` on the other, so the box hugs the fitted
// picture (no stretch) and a corner drag preserves the picture's own aspect.
interface Box { x: number; y: number; w: number; h: number; }

function clipBox(c: Clip, cb: CanvasBox): Box {
  const { x, y, scale } = xform(c);
  const { ax, ay } = aspectOf(c);
  const cu = 0.5 + 0.5 * x; // center, 0..1 across the canvas
  const cv = 0.5 - 0.5 * y; // y is up in clip space, down on screen
  const w = scale * ax * cb.w;
  const h = scale * ay * cb.h;
  return { x: cb.left + cu * cb.w - w / 2, y: cb.top + cv * cb.h - h / 2, w, h };
}

function kindOfClip(c: Clip, kindOf: Map<string, string | undefined>): string {
  return kindOf.get(c.assetId) ?? (c.src ? 'image' : 'procedural');
}

// A title clip is grabbed by the box hugging its glyphs (computed below), not a
// scale-derived quad — picture clips keep the uniform `scale` box.
function isText(c: Clip, kindOf: Map<string, string | undefined>): boolean {
  return kindOfClip(c, kindOf) === 'text';
}

// Clips this overlay can grab. Audio carries no picture, so only it is skipped —
// pictures use their `scale` box, text uses its measured glyph box.
function selectable(c: Clip, kindOf: Map<string, string | undefined>): boolean {
  return !c.audioOnly && kindOfClip(c, kindOf) !== 'audio';
}

// A shared 2D context for measuring a title's rendered width, mirroring the
// font the compositor paints text with (renderer.paintText).
let measureCv: HTMLCanvasElement | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!measureCv) measureCv = document.createElement('canvas');
  return measureCv.getContext('2d')!;
}

// Stage-local box hugging a title's glyphs. Text is painted onto a full-frame
// canvas (project resolution) and drawn through the clip's quad, so we measure
// the text block in canvas space, turn it into canvas fractions, then map those
// fractions through the same quad placement the renderer uses. Returns null for
// empty text (nothing is drawn, so there's nothing to grab).
function textBox(c: Clip, cb: CanvasBox, projW: number, projH: number): Box | null {
  const raw = (c.text ?? '').trim();
  if (!raw) return null;
  const w = Math.max(16, Math.round(projW || 1280));
  const h = Math.max(16, Math.round(projH || 720));
  const size = Math.max(4, c.fontSize ?? 64);
  const weight = c.fontWeight ?? 700;
  const align = c.align ?? 'center';
  const ctx = measureCtx();
  ctx.font = `${weight} ${size}px ${fontStack(c.fontFamily)}`;
  const lines = raw.split('\n');
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
  const pad = Math.round(w * 0.06);                 // matches paintText's side inset
  const blockH = lines.length * size * 1.22;        // matches paintText's line height
  const by0 = h / 2 - blockH / 2;
  const by1 = h / 2 + blockH / 2;
  let bx0: number, bx1: number;
  if (align === 'left') { bx0 = pad; bx1 = pad + maxW; }
  else if (align === 'right') { bx1 = w - pad; bx0 = w - pad - maxW; }
  else { bx0 = w / 2 - maxW / 2; bx1 = w / 2 + maxW / 2; }
  // canvas fractions → quad placement (cu/cv mirror clipBox, keyframes applied)
  const xf = xform(c);
  const cu = 0.5 + 0.5 * xf.x;
  const cv = 0.5 - 0.5 * xf.y;
  const quadLeft = cb.left + (cu - xf.scale / 2) * cb.w;
  const quadTop = cb.top + (cv - xf.scale / 2) * cb.h;
  const quadW = xf.scale * cb.w;
  const quadH = xf.scale * cb.h;
  return {
    x: quadLeft + (bx0 / w) * quadW,
    y: quadTop + (by0 / h) * quadH,
    w: ((bx1 - bx0) / w) * quadW,
    h: ((by1 - by0) / h) * quadH,
  };
}

// the box of any selectable clip — measured glyphs for text, scale quad for
// pictures (null when off the box / empty text)
function clipScreenBox(c: Clip, cb: CanvasBox, kindOf: Map<string, string | undefined>, projW: number, projH: number): Box | null {
  return isText(c, kindOf) ? textBox(c, cb, projW, projH) : clipBox(c, cb);
}

// the selectable clips on screen right now, sorted top-first (index 0 wins),
// matching how Preview.buildLayers stacks tracks.
function activeSelectableClips(): Clip[] {
  const st = useStore.getState();
  const kindOf = new Map(st.assets.map((a) => [a.id, a.kind as string | undefined]));
  const trackIndex = new Map(st.project.tracks.map((t) => [t.id, t.index]));
  return st.clips
    .filter((c) => st.playhead >= c.start && st.playhead < c.start + c.duration && selectable(c, kindOf))
    .sort((a, b) => (trackIndex.get(a.trackId) ?? 0) - (trackIndex.get(b.trackId) ?? 0));
}

// topmost clip whose box contains the stage-local point — the thing the user
// is pointing at, so a click selects the shape under the cursor (not just the
// one on top of the whole stack).
function clipAtPoint(lx: number, ly: number, cb: CanvasBox, projW: number, projH: number): Clip | null {
  const st = useStore.getState();
  const kindOf = new Map(st.assets.map((a) => [a.id, a.kind as string | undefined]));
  for (const c of activeSelectableClips()) {
    const b = clipScreenBox(c, cb, kindOf, projW, projH);
    if (b && lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return c;
  }
  return null;
}

type Corner = { id: string; hx: -1 | 1; hy: -1 | 1; cursor: string };
const HANDLES: Corner[] = [
  { id: 'nw', hx: -1, hy: -1, cursor: 'nwse-resize' },
  { id: 'ne', hx: 1, hy: -1, cursor: 'nesw-resize' },
  { id: 'se', hx: 1, hy: 1, cursor: 'nwse-resize' },
  { id: 'sw', hx: -1, hy: 1, cursor: 'nesw-resize' },
];
const HS = 11; // handle size, px
const ROT_OFFSET = 26; // px the rotate handle floats above the box's top edge
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const MIN_FONT = 12;  // text resize clamps, matching the Inspector's Size slider
const MAX_FONT = 220;

// Direct, on-stage manipulation of the selected clip — click to select the
// shape under the cursor, drag its body to move, drag a corner to resize
// (the opposite corner stays pinned, aspect preserved). Mirrors the optimistic
// + debounced-save pattern the Inspector uses so edits show instantly and land.
export function SelectionOverlay({ canvas }: { canvas: CanvasBox }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);

  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const projW = useStore((s) => s.project.width);
  const projH = useStore((s) => s.project.height);
  const fps = useStore((s) => s.project.fps);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  // Escape clears the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.getState().select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // debounced persist of the live transform; releases the remote-sync guard.
  // fontSize + keyframes ride along so a title resize and any keyframed drag
  // land too (no-ops for an un-keyframed picture).
  const save = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const c = useStore.getState().clips.find((x) => x.id === useStore.getState().selectedClipId);
      if (c) await api.patchClip(c.id, { x: c.x, y: c.y, scale: c.scale, rotation: c.rotation, fontSize: c.fontSize, keyframes: c.keyframes });
      useStore.getState().setSuspendRemote(false);
    }, 200);
  };

  // Apply a live transform during a drag. For any property that is keyframed,
  // the value is written as a keyframe at the current playhead (so dragging an
  // animated clip authors motion); otherwise it sets the static field. Reads the
  // current clip each call so the keyframe added on the previous frame is
  // updated, not duplicated.
  const setTransform = (clipId: string, vals: Partial<Record<'x' | 'y' | 'scale', number>>) => {
    const st = useStore.getState();
    const clip = st.clips.find((x) => x.id === clipId);
    if (!clip) return;
    const eps = 0.5 / (fps || 30);
    const local = clamp(st.playhead - clip.start, 0, clip.duration);
    let kfs = clip.keyframes;
    const patch: Partial<Clip> = {};
    (['scale', 'x', 'y'] as const).forEach((prop) => {
      const v = vals[prop];
      if (v === undefined) return;
      if (isAnimated(clip, prop)) {
        kfs = upsertKeyframe({ ...clip, keyframes: kfs }, prop, local, v, eps);
      } else {
        patch[prop] = v;
      }
    });
    if (kfs !== clip.keyframes) patch.keyframes = kfs;
    st.patchClipLocal(clipId, patch);
  };

  // the selected clip, but only while it is actually on screen (a box over an
  // invisible clip would be confusing)
  const kindOf = new Map(assets.map((a) => [a.id, a.kind as string | undefined]));
  const selected = clips.find((c) => c.id === selectedId) || null;
  const onScreen = !!selected
    && playhead >= selected.start && playhead < selected.start + selected.duration
    && selectable(selected, kindOf);
  const selectedIsText = !!selected && isText(selected, kindOf);
  const box = selected && onScreen ? clipScreenBox(selected, canvas, kindOf, projW, projH) : null;

  // drag the body — moves the clip (x/y), scale unchanged
  const beginMove = (clip: Clip, e: React.PointerEvent) => {
    e.preventDefault();
    useStore.getState().setSuspendRemote(true);
    const startX = e.clientX, startY = e.clientY;
    const c0 = useStore.getState().clips.find((x) => x.id === clip.id) ?? clip;
    // start from the displayed (keyframe-evaluated) position so an animated clip
    // moves smoothly from where it sits, not from its static baseline
    const base0 = xform(c0);
    const x0 = base0.x, y0 = base0.y;
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const nx = clamp(x0 + (2 * (ev.clientX - startX)) / canvas.w, -1, 1);
      const ny = clamp(y0 - (2 * (ev.clientY - startY)) / canvas.h, -1, 1);
      setTransform(clip.id, { x: nx, y: ny });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) save();
      else useStore.getState().setSuspendRemote(false); // a plain click, nothing to persist
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // drag a corner — uniform resize, the opposite corner pinned in place
  const beginResize = (h: Corner, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    const clip = useStore.getState().clips.find((x) => x.id === selectedId);
    if (!root || !clip) return;
    useStore.getState().setSuspendRemote(true);
    const sr = root.getBoundingClientRect();
    const { ax: fx, ay: fy } = aspectOf(clip);
    const b0 = clipBox(clip, canvas);
    // opposite corner stays fixed (stage-local px)
    const anchorX = h.hx < 0 ? b0.x + b0.w : b0.x;
    const anchorY = h.hy < 0 ? b0.y + b0.h : b0.y;
    const move = (ev: PointerEvent) => {
      const px = ev.clientX - sr.left;
      const py = ev.clientY - sr.top;
      // the box is scale·fx·canvas.w by scale·fy·canvas.h; recover scale from
      // whichever axis the pointer pulls further, keeping the picture's aspect
      const s = clamp(Math.max(
        fx > 0 ? Math.abs(px - anchorX) / (fx * canvas.w) : 0,
        fy > 0 ? Math.abs(py - anchorY) / (fy * canvas.h) : 0,
      ), MIN_SCALE, MAX_SCALE);
      // re-center so the anchor corner doesn't move
      const ncx = anchorX + (h.hx * s * fx * canvas.w) / 2;
      const ncy = anchorY + (h.hy * s * fy * canvas.h) / 2;
      const nx = clamp((2 * (ncx - canvas.left)) / canvas.w - 1, -1, 1);
      const ny = clamp(1 - (2 * (ncy - canvas.top)) / canvas.h, -1, 1);
      setTransform(clip.id, { scale: s, x: nx, y: ny });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // drag a corner of a title — grows/shrinks the font size. The text stays
  // centered on its vertical midline (independent of size), so the box height
  // tracks fontSize exactly: the new half-height over the old gives the factor.
  const beginResizeText = (h: Corner, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    const clip = useStore.getState().clips.find((x) => x.id === selectedId);
    if (!root || !clip) return;
    const b0 = textBox(clip, canvas, projW, projH);
    if (!b0) return;
    useStore.getState().setSuspendRemote(true);
    const sr = root.getBoundingClientRect();
    const fs0 = clip.fontSize ?? 64;
    const cy = b0.y + b0.h / 2;          // fixed vertical midline of the glyphs
    const half0 = Math.max(6, b0.h / 2);
    const move = (ev: PointerEvent) => {
      const py = ev.clientY - sr.top;
      const fs = clamp((fs0 * Math.abs(py - cy)) / half0, MIN_FONT, MAX_FONT);
      useStore.getState().patchClipLocal(clip.id, { fontSize: fs });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // drag the rotate handle: spin the clip about the same centre the renderer
  // pivots on (the clip's placement point), so the box and picture stay locked.
  const beginRotate = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    const clip = useStore.getState().clips.find((x) => x.id === selectedId);
    if (!root || !clip) return;
    useStore.getState().setSuspendRemote(true);
    const sr = root.getBoundingClientRect();
    const xf = xform(clip);
    const cx = sr.left + (0.5 + 0.5 * xf.x) * canvas.w + canvas.left;
    const cy = sr.top + (0.5 - 0.5 * xf.y) * canvas.h + canvas.top;
    const move = (ev: PointerEvent) => {
      // handle sits straight up at 0°, so +90 maps "up" to zero; clockwise +
      let deg = Math.round((Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90);
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15; // snap to 15° with Shift
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      useStore.getState().patchClipLocal(clip.id, { rotation: deg });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // press anywhere on the stage: grab the shape under the cursor (select +
  // begin moving in one gesture), or clear the selection on empty space
  const onStageDown = (e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    const sr = root.getBoundingClientRect();
    const hit = clipAtPoint(e.clientX - sr.left, e.clientY - sr.top, canvas, projW, projH);
    if (!hit) { useStore.getState().select(null); return; }
    useStore.getState().select(hit.id);
    beginMove(hit, e);
  };

  // rotation + pivot for the box: spin the whole group about the clip's
  // placement centre (where the renderer pivots), so box and picture stay locked
  const rot = selected?.rotation ?? 0;
  let pivotX = box ? box.w / 2 : 0;
  let pivotY = box ? box.h / 2 : 0;
  if (box && selected) {
    const xf = xform(selected);
    pivotX = canvas.left + (0.5 + 0.5 * xf.x) * canvas.w - box.x;
    pivotY = canvas.top + (0.5 - 0.5 * xf.y) * canvas.h - box.y;
  }

  return (
    <div className="stage-interact" ref={rootRef} onPointerDown={onStageDown}>
      {box && !playing && (
        <div
          className="select-group"
          style={{
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            transform: rot ? `rotate(${rot}deg)` : undefined,
            transformOrigin: `${pivotX}px ${pivotY}px`,
          }}
        >
          <div
            className="select-box"
            style={{ left: 0, top: 0, width: box.w, height: box.h }}
            onPointerDown={(e) => { e.stopPropagation(); if (selected) beginMove(selected, e); }}
          />
          <div className="rotate-stem" style={{ left: box.w / 2 }} />
          <div
            className="rotate-handle"
            style={{ left: box.w / 2, top: -ROT_OFFSET }}
            title="Drag to rotate · hold Shift to snap to 15°"
            onPointerDown={beginRotate}
          />
          {HANDLES.map((h) => (
            <div
              key={h.id}
              className="select-handle"
              style={{
                left: (h.hx > 0 ? box.w : 0) - HS / 2,
                top: (h.hy > 0 ? box.h : 0) - HS / 2,
                width: HS,
                height: HS,
                cursor: h.cursor,
              }}
              onPointerDown={(e) => (selectedIsText ? beginResizeText(h, e) : beginResize(h, e))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
