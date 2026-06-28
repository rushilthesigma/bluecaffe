import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { createCompositor, type Compositor, type Layer } from '../webgpu/renderer';
import { createAudioEngine, type AudioEngine } from '../audio';
import { SelectionOverlay, type CanvasBox } from './SelectionOverlay';
import { evalProp } from '../keyframes';
import { fitExtents } from '../aspect';
import { isPushKind } from '../types';
import type { Asset, Clip, EaseKind, Track, TransitionKind } from '../types';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const compRef = useRef<Compositor | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);

  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const playhead = useStore((s) => s.playhead);
  const project = useStore((s) => s.project);

  // the canvas's displayed rect (CSS px, relative to the stage) — drives where
  // the on-stage selection box + resize handles are drawn
  const [canvasBox, setCanvasBox] = useState<CanvasBox | null>(null);

  // create compositor once
  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current!;
    createCompositor(canvas).then((c) => {
      if (disposed) {
        c.dispose();
        return;
      }
      compRef.current = c;
      (window as unknown as { __dsBackend: string }).__dsBackend = c.backend;
    });
    return () => {
      disposed = true;
      compRef.current?.dispose();
      compRef.current = null;
    };
  }, []);

  // audio engine — plays sound for audio + video clips, synced to the playhead
  useEffect(() => {
    audioRef.current = createAudioEngine();
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  // keep the drawing buffer matched to the displayed size + aspect
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const ar = project.width / project.height;
      const availW = wrap.clientWidth;
      const availH = wrap.clientHeight;
      let w = availW;
      let h = w / ar;
      if (h > availH) {
        h = availH;
        w = h * ar;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${Math.floor(w)}px`;
      canvas.style.height = `${Math.floor(h)}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      // record the canvas's displayed rect relative to the stage so the
      // selection overlay can sit exactly on top of the picture
      const cr = canvas.getBoundingClientRect();
      const sr = wrap.getBoundingClientRect();
      setCanvasBox({ left: cr.left - sr.left, top: cr.top - sr.top, w: cr.width, h: cr.height });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  // render + playback loop
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const st = useStore.getState();

      if (st.playing) {
        const contentEnd = st.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        let next = st.playhead + dt;
        if (next >= contentEnd && contentEnd > 0) {
          // a looping clip turns the whole preview into a loop: wrap the
          // playhead back to the start of the timeline and keep playing,
          // instead of stopping at the end.
          if (st.clips.some((c) => c.loop)) {
            next -= contentEnd;
            if (next < 0 || next >= contentEnd) next = 0;
          } else {
            next = contentEnd;
            st.setPlaying(false);
          }
        }
        st.setPlayhead(next);
      }

      const comp = compRef.current;
      if (comp) {
        const cur = useStore.getState();
        const layers = buildLayers(cur.clips, cur.project.tracks, cur.assets, cur.playhead, cur.project.width, cur.project.height);
        comp.render(layers, cur.playing);
        audioRef.current?.sync(cur.clips, cur.assets, cur.playhead, cur.playing);
        (window as unknown as { __dsFrames: number }).__dsFrames = ((window as unknown as { __dsFrames?: number }).__dsFrames ?? 0) + 1;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const contentEnd = useStore((s) => s.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));

  // frame-accurate step + quick snapshot / fullscreen for the player bar
  const step = (frames: number) => {
    const dt = frames / (project.fps || 30);
    const end = contentEnd || Infinity;
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(end, playhead + dt)));
  };
  const snapshot = () => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `${(project.name || 'frame').replace(/[^\w.-]+/g, '-')}-frame.png`;
      a.click();
    } catch { /* canvas not readable */ }
  };
  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <section className="panel preview">
      <div className="preview-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="preview-canvas" />
        {canvasBox && <SelectionOverlay canvas={canvasBox} />}
      </div>
      <div className="player">
        <div className="player-left">
          <span className="tc">{timecode(playhead, project.fps)}</span>
          <span className="tc dim">/ {timecode(contentEnd, project.fps)}</span>
        </div>
        <div className="player-center">
          <button className="pl-btn" onClick={() => setPlayhead(0)} title="To start">⏮</button>
          <button className="pl-btn" onClick={() => step(-1)} title="Previous frame">◁</button>
          <button className="pl-play" onClick={() => setPlaying(!playing)} title={playing ? 'Pause (space)' : 'Play (space)'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="pl-btn" onClick={() => step(1)} title="Next frame">▷</button>
          <button className="pl-btn" onClick={() => setPlayhead(contentEnd)} title="To end">⏭</button>
        </div>
        <div className="player-right">
          <button className="pl-btn" onClick={snapshot} title="Snapshot frame (PNG)">▣</button>
          <button className="pl-btn" onClick={fullscreen} title="Fullscreen preview">⛶</button>
        </div>
      </div>
    </section>
  );
}

// hard cap mirrored from the compositor's MAX_LAYERS
const MAX_LAYERS = 16;

// Maps an easing kind to a 0→1 output for a 0→1 input. Used by all four
// transition helpers so the user's chosen curve applies consistently.
function applyTransEase(t: number, ease: EaseKind): number {
  const n1 = 7.5625, d1 = 2.75;
  switch (ease) {
    case 'linear':     return t;
    case 'ease-in':    return t * t * t;
    case 'ease-out':   return 1 - Math.pow(1 - t, 3);
    case 'ease':
    case 'ease-in-out': return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    case 'back': { const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); }
    case 'elastic': {
      if (t===0||t===1) return t;
      const c4=(2*Math.PI)/3;
      return Math.pow(2,-10*t)*Math.sin((t*10-0.75)*c4)+1;
    }
    case 'bounce': {
      let tt=t;
      if (tt<1/d1) return n1*tt*tt;
      if (tt<2/d1) { tt-=1.5/d1;  return n1*tt*tt+0.75; }
      if (tt<2.5/d1) { tt-=2.25/d1; return n1*tt*tt+0.9375; }
      tt-=2.625/d1; return n1*tt*tt+0.984375;
    }
    default: return t;
  }
}

// the direction the picture travels for each push, in NDC (x: +right, y: +up)
const PUSH_DIR: Partial<Record<Exclude<TransitionKind, 'none'>, [number, number]>> = {
  'push-up': [0, 1],
  'push-down': [0, -1],
  'push-left': [-1, 0],
  'push-right': [1, 0],
  'push-tl': [-1, 1],
  'push-tr': [1, 1],
  'push-bl': [-1, -1],
  'push-br': [1, -1],
};

// Slide offset a clip is currently displaced by, in NDC. On entry the clip
// starts one frame behind its motion direction and eases in (decelerating into
// place); on exit it accelerates one frame ahead and off screen. `1 + scale`
// guarantees the picture clears the frame edge whatever its size. Only the
// directional push kinds displace; fade/dissolve ride opacity (see crossMul).
function pushOffset(c: Clip, local: number, remaining: number): [number, number] {
  let dx = 0;
  let dy = 0;
  const mag = 1 + c.scale;
  const tin = c.transIn;
  const tinDur = c.transInDur ?? 0;
  if (isPushKind(tin) && tinDur > 0 && local < tinDur) {
    const p = Math.max(0, Math.min(1, local / tinDur));
    const eased = c.transInEase ? applyTransEase(p, c.transInEase) : 1 - Math.pow(1 - p, 3);
    const [ux, uy] = PUSH_DIR[tin as Exclude<TransitionKind, 'none'>]!;
    dx -= ux * mag * (1 - eased);
    dy -= uy * mag * (1 - eased);
  }
  const tout = c.transOut;
  const toutDur = c.transOutDur ?? 0;
  if (isPushKind(tout) && toutDur > 0 && remaining < toutDur) {
    const q = Math.max(0, Math.min(1, remaining / toutDur));
    const exitP = 1 - q;
    const eased = c.transOutEase ? applyTransEase(exitP, c.transOutEase) : Math.pow(exitP, 3);
    const [ux, uy] = PUSH_DIR[tout as Exclude<TransitionKind, 'none'>]!;
    dx += ux * mag * eased;
    dy += uy * mag * eased;
  }
  return [dx, dy];
}

// Transitions that ramp opacity (fade, dissolve, zoom, spin all fade alongside
// their primary effect so the cut doesn't flash). Fade/dissolve only.
const FADING_KINDS = new Set<string>(['fade', 'dissolve', 'zoom-in', 'zoom-out', 'spin']);

// Opacity multiplier for transitions that ramp transparency. A fade dips to the
// dark stage; a dissolve cross-blends; zoom and spin also fade so the clip doesn't
// pop in at full opacity while still at an extreme scale/rotation.
function crossMul(c: Clip, local: number, remaining: number): number {
  let m = 1;
  const tinDur = c.transInDur ?? 0;
  if (FADING_KINDS.has(c.transIn ?? '') && tinDur > 0 && local < tinDur) {
    const p = Math.max(0, Math.min(1, local / tinDur));
    m *= Math.max(0, c.transInEase ? applyTransEase(p, c.transInEase) : p);
  }
  const toutDur = c.transOutDur ?? 0;
  if (FADING_KINDS.has(c.transOut ?? '') && toutDur > 0 && remaining < toutDur) {
    const q = Math.max(0, Math.min(1, remaining / toutDur));
    m *= Math.max(0, c.transOutEase ? 1 - applyTransEase(1 - q, c.transOutEase) : q);
  }
  return m;
}

// Scale multiplier for zoom-in/zoom-out transitions. Composes on top of the
// clip's keyframed scale so the effect still works on scaled clips.
function scaleMul(c: Clip, local: number, remaining: number): number {
  let s = 1;
  const tinDur = c.transInDur ?? 0;
  if (tinDur > 0 && local < tinDur) {
    const p = Math.max(0, Math.min(1, local / tinDur));
    const eased = c.transInEase ? applyTransEase(p, c.transInEase) : 1 - (1 - p) ** 3;
    if (c.transIn === 'zoom-in') s *= eased;
    else if (c.transIn === 'zoom-out') s *= 2 - eased;
  }
  const toutDur = c.transOutDur ?? 0;
  if (toutDur > 0 && remaining < toutDur) {
    const q = Math.max(0, Math.min(1, remaining / toutDur));
    if (c.transOutEase) {
      const exitP = 1 - q;
      const eased = applyTransEase(exitP, c.transOutEase);
      if (c.transOut === 'zoom-in') s *= 1 - eased;
      else if (c.transOut === 'zoom-out') s *= 1 + eased;
    } else {
      const eased = q ** 3;
      if (c.transOut === 'zoom-in') s *= eased;
      else if (c.transOut === 'zoom-out') s *= 2 - eased;
    }
  }
  return s;
}

// Rotation delta (degrees) for the spin transition. Combined with crossMul
// opacity so the clip fades while it spins.
function spinRot(c: Clip, local: number, remaining: number): number {
  let r = 0;
  const tinDur = c.transInDur ?? 0;
  if (c.transIn === 'spin' && tinDur > 0 && local < tinDur) {
    const p = Math.max(0, Math.min(1, local / tinDur));
    const eased = c.transInEase ? applyTransEase(p, c.transInEase) : 1 - (1 - p) ** 3;
    r += 270 * (1 - eased);
  }
  const toutDur = c.transOutDur ?? 0;
  if (c.transOut === 'spin' && toutDur > 0 && remaining < toutDur) {
    const q = Math.max(0, Math.min(1, remaining / toutDur));
    r -= c.transOutEase ? 270 * applyTransEase(1 - q, c.transOutEase) : 270 * (1 - q ** 3);
  }
  return r;
}

// What a clip is doing at the playhead: playing normally, or pre-rolling its
// first frame over the previous clip's tail to cross-dissolve into it.
interface RenderEntry { c: Clip; preroll: number | null }

export function buildLayers(clips: Clip[], tracks: Track[], assets: Asset[], playhead: number, projW: number, projH: number): Layer[] {
  const trackIndex = new Map(tracks.map((t) => [t.id, t.index]));
  const kindOf = new Map(assets.map((a) => [a.id, a.kind]));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const isAudio = (c: Clip) => c.audioOnly || kindOf.get(c.assetId) === 'audio';
  // audio clips carry no picture — they are played by the audio engine, not drawn
  const entries: RenderEntry[] = clips
    .filter((c) => !isAudio(c) && playhead >= c.start && playhead < c.start + c.duration)
    .map((c) => ({ c, preroll: null }));

  // dissolve junctions: an incoming clip is shown a beat before it formally
  // begins, frozen on its first frame and ramping opacity up, while the outgoing
  // clip's own dissolve-out ramps it down — the two cross-blend across the cut.
  for (const c of clips) {
    if (isAudio(c) || c.transIn !== 'dissolve') continue;
    const d = c.transInDur ?? 0;
    if (d <= 0 || playhead >= c.start || playhead < c.start - d) continue;
    const neighbor = clips.find((p) =>
      p.id !== c.id && p.trackId === c.trackId
      && Math.abs(p.start + p.duration - c.start) < 0.02
      && p.transOut === 'dissolve');
    if (!neighbor) continue;
    entries.push({ c, preroll: Math.max(0, Math.min(1, (playhead - (c.start - d)) / d)) });
  }

  // draw back-to-front: a higher track index is further back, so the lower the
  // index the later it draws and the more it wins — the topmost track in the UI
  // (index 0) ends up on top of everything beneath it. Within a track, the later
  // clip draws on top so a pre-rolling incoming clip blends over the outgoing one.
  entries.sort((a, b) => {
    const t = (trackIndex.get(b.c.trackId) ?? 0) - (trackIndex.get(a.c.trackId) ?? 0);
    return t !== 0 ? t : a.c.start - b.c.start;
  });
  // if more layers are active than the compositor can draw, keep the ones with
  // precedence — those are last in the array (the top tracks).
  const visible = entries.length > MAX_LAYERS ? entries.slice(entries.length - MAX_LAYERS) : entries;
  return visible.map(({ c, preroll }) => {
    // a pre-rolling clip sits at its own start (first frame), opacity led by the
    // pre-roll ramp; otherwise it plays at the playhead with its normal blends.
    const local = preroll === null ? playhead - c.start : 0;
    const remaining = preroll === null ? c.start + c.duration - playhead : c.duration;
    // keyframes (if any) drive the transform; fades and transitions then compose
    // on top of the keyframed base values.
    let op = evalProp(c, 'opacity', local, c.opacity);
    if (c.fadeIn > 0 && local < c.fadeIn) op *= Math.max(0, local / c.fadeIn);
    if (c.fadeOut > 0 && remaining < c.fadeOut) op *= Math.max(0, remaining / c.fadeOut);
    op *= preroll === null ? crossMul(c, local, remaining) : preroll;
    const kind = (kindOf.get(c.assetId) ?? (c.src ? 'image' : 'procedural')) as Layer['kind'];
    const textured = kind === 'image' || kind === 'video';
    const isText = kind === 'text';
    // a looping clip wraps its source within the trimmed [inPoint, sourceDuration] window
    const period = c.sourceDuration - c.inPoint;
    const sourceTime = c.loop && period > 0.05 ? c.inPoint + (local % period) : local + c.inPoint;
    // slide the clip in/out of place if it has a push transition set (pre-roll
    // clips are not pushed — they only fade in)
    const [pdx, pdy] = preroll === null ? pushOffset(c, local, remaining) : [0, 0];
    const sm = preroll === null ? scaleMul(c, local, remaining) : 1;
    const sr = preroll === null ? spinRot(c, local, remaining) : 0;
    // pictures keep their own aspect (contain-fit); text/procedural fill the frame
    const a = assetById.get(c.assetId);
    const { ax, ay } = textured ? fitExtents(a?.width, a?.height, projW, projH) : { ax: 1, ay: 1 };
    return {
      id: preroll === null ? c.id : `${c.id}__pre`,
      kind,
      hue: (evalProp(c, 'hue', local, c.hue) % 360) / 360,
      brightness: evalProp(c, 'brightness', local, c.brightness),
      saturation: evalProp(c, 'saturation', local, c.saturation ?? 1),
      contrast: evalProp(c, 'contrast', local, c.contrast ?? 1),
      temperature: evalProp(c, 'temperature', local, c.temperature ?? 0),
      opacity: Math.max(0, Math.min(1, op)),
      x: evalProp(c, 'x', local, c.x) + pdx,
      y: evalProp(c, 'y', local, c.y) + pdy,
      scale: evalProp(c, 'scale', local, c.scale) * sm,
      rotation: (c.rotation ?? 0) + sr,
      aspectX: ax,
      aspectY: ay,
      assetId: textured ? c.assetId : null,
      url: textured ? c.src : null,
      time: sourceTime,
      blur: c.blur ?? 0,
      vignette: c.vignette ?? 0,
      grain: c.grain ?? 0,
      pixelate: c.pixelate ?? 0,
      // text overlay properties
      text: isText ? (c.text ?? '') : undefined,
      fontSize: isText ? (c.fontSize ?? 64) : undefined,
      fontColor: isText ? (c.fontColor ?? '#ffffff') : undefined,
      align: isText ? (c.align ?? 'center') : undefined,
      fontWeight: isText ? (c.fontWeight ?? 700) : undefined,
      fontFamily: isText ? (c.fontFamily ?? 'system') : undefined,
      projW,
      projH,
    };
  });
}

function timecode(sec: number, fps: number): string {
  const s = Math.max(0, sec);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ff = Math.floor((s - Math.floor(s)) * fps);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(mm)}:${p(ss)}:${p(ff)}`;
}
