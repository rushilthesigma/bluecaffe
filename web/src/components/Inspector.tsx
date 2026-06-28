import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { duplicateClip, splitClip, removeClip } from '../clipActions';
import { FONTS } from '../fonts';
import {
  KEYABLE, type KeyableMeta, kfFor, isAnimated, evalProp, keyframeAt,
  upsertKeyframe, removeKeyframe, adjacentKeyframeTime, keyframeTimes,
  setKeyframeEase,
} from '../keyframes';
import { ALL_TRANSITIONS, DEFAULT_TRANS_DUR, TransIcon } from '../transitions';
import type { Clip, TransitionKind, EaseKind } from '../types';

// Shared optimistic + debounced-save commit used by both property windows. The
// pending timer is deliberately not cancelled on unmount, so the last keystroke
// still lands when you switch between the Inspector and Text windows mid-edit.
export function useClipCommit() {
  const saveTimer = useRef<number | null>(null);
  return (clipId: string, patch: Partial<Clip>) => {
    useStore.getState().setSuspendRemote(true);
    useStore.getState().patchClipLocal(clipId, patch);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const c = useStore.getState().clips.find((x) => x.id === clipId);
      if (c) {
        await api.patchClip(c.id, {
          start: c.start, duration: c.duration, inPoint: c.inPoint,
          opacity: c.opacity, x: c.x, y: c.y, scale: c.scale, rotation: c.rotation,
          fadeIn: c.fadeIn, fadeOut: c.fadeOut,
          transIn: c.transIn, transInDur: c.transInDur, transInEase: c.transInEase,
          transOut: c.transOut, transOutDur: c.transOutDur, transOutEase: c.transOutEase,
          hue: c.hue, brightness: c.brightness,
          saturation: c.saturation, contrast: c.contrast, temperature: c.temperature,
          filter: c.filter, trackId: c.trackId,
          text: c.text, fontSize: c.fontSize, fontColor: c.fontColor,
          align: c.align, fontWeight: c.fontWeight, fontFamily: c.fontFamily,
          muted: c.muted, audioOnly: c.audioOnly, volume: c.volume,
          keyframes: c.keyframes,
          blur: c.blur, vignette: c.vignette, grain: c.grain, pixelate: c.pixelate,
        });
      }
      useStore.getState().setSuspendRemote(false);
    }, 180);
  };
}

// The clip window: placement, transform, look and fades for the selected clip.
// A title's words are edited in their own window (TextPanel), apart from these.
export function Inspector() {
  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedClipId) || null);
  const assetKind = useStore((s) => {
    const c = s.clips.find((x) => x.id === s.selectedClipId);
    return c ? s.assets.find((a) => a.id === c.assetId)?.kind : undefined;
  });
  const tracks = useStore((s) => s.project.tracks);
  const playhead = useStore((s) => s.playhead);
  const fps = useStore((s) => s.project.fps);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const rawCommit = useClipCommit();

  // can we split here? only when the playhead sits inside the clip with room on
  // both sides — mirrors the timeline's right-click guard.
  const canSplit = clip != null && playhead > clip.start + 0.2 && playhead < clip.start + clip.duration - 0.2;

  if (!clip) {
    return (
      <div className="inspector empty">
        <p className="empty-title">No clip selected</p>
        <p className="empty-sub">Select a clip on the timeline to edit its trim, transform, and look.</p>
      </div>
    );
  }

  const commit = (patch: Partial<Clip>) => rawCommit(clip.id, patch);

  const maxDur = clip.sourceDuration - clip.inPoint;
  const isText = assetKind === 'text';
  const grade = {
    brightness: clip.brightness ?? 1,
    saturation: clip.saturation ?? 1,
    contrast: clip.contrast ?? 1,
    temperature: clip.temperature ?? 0,
  };

  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="insp-swatch" style={{ background: clip.color }} />
        <span className="insp-name">{isText ? (clip.text?.split('\n')[0] || 'Text') : clip.name}</span>
      </div>

      <div className="insp-actions">
        <button className="btn sm" onClick={() => duplicateClip(clip)} title="Drop a copy after this clip">＋ Duplicate</button>
        <button className="btn sm" disabled={!canSplit} onClick={() => canSplit && splitClip(clip, playhead)} title="Cut in two at the playhead">✂ Split</button>
        <button className="btn danger sm" onClick={() => removeClip(clip)} title="Remove this clip">Delete</button>
      </div>

      <Group title="Placement">
        <Row label="Track">
          <select value={clip.trackId} onChange={(e) => commit({ trackId: e.target.value })}>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Row>
        <Num label="Start" value={clip.start} step={0.1} min={0} onChange={(v) => commit({ start: v })} unit="s" />
        <Num label="Duration" value={clip.duration} step={0.1} min={0.2} max={maxDur} onChange={(v) => commit({ duration: v })} unit="s" />
        {!isText && (
          <>
            <Num label="In point" value={clip.inPoint} step={0.1} min={0} max={clip.sourceDuration - 0.2} onChange={(v) => commit({ inPoint: v })} unit="s" />
            <p className="insp-note">source {clip.sourceDuration.toFixed(1)}s</p>
          </>
        )}
      </Group>

      <Group title="Transform">
        <AlignGrid x={clip.x ?? 0} y={clip.y ?? 0} onChange={(x, y) => commit({ x, y })} />
        {KEYABLE.map((meta) => (
          <KeyableSlider
            key={meta.prop}
            clip={clip}
            meta={meta}
            fps={fps}
            playhead={playhead}
            commit={commit}
            setPlayhead={setPlayhead}
          />
        ))}
        <KeyframeTrack clip={clip} playhead={playhead} setPlayhead={setPlayhead} />
        <Slider label="Rotation" value={clip.rotation ?? 0} min={-180} max={180} step={1} onChange={(v) => commit({ rotation: v })} unit="°" />
      </Group>

      {!isText && (
        <Group title="Filters">
          <FilterGallery active={clip.filter ?? 'none'} grade={grade} clip={clip} assetKind={assetKind} onPick={(p) => commit(p.grade)} />
          <Slider label="Brightness" value={grade.brightness} min={0} max={2} step={0.01} onChange={(v) => commit({ brightness: v, filter: 'custom' })} />
          <Slider label="Saturation" value={grade.saturation} min={0} max={2} step={0.01} onChange={(v) => commit({ saturation: v, filter: 'custom' })} />
          <Slider label="Contrast" value={grade.contrast} min={0} max={2} step={0.01} onChange={(v) => commit({ contrast: v, filter: 'custom' })} />
          <Slider label="Warmth" value={grade.temperature} min={-1} max={1} step={0.01} onChange={(v) => commit({ temperature: v, filter: 'custom' })} />
          <Slider label="Hue" value={clip.hue} min={0} max={360} step={1} onChange={(v) => commit({ hue: v })} />
        </Group>
      )}

      <Group title="Transitions">
        <TransRow label="In" side="in" clip={clip} commit={commit} />
        <TransRow label="Out" side="out" clip={clip} commit={commit} />
        <p className="insp-note">Set the same on two touching clips, or use the + on the timeline seam, to transition between them.</p>
      </Group>

      <Group title="Fades">
        <Slider label="Fade in" value={clip.fadeIn} min={0} max={Math.min(4, clip.duration)} step={0.1} onChange={(v) => commit({ fadeIn: v })} unit="s" />
        <Slider label="Fade out" value={clip.fadeOut} min={0} max={Math.min(4, clip.duration)} step={0.1} onChange={(v) => commit({ fadeOut: v })} unit="s" />
      </Group>
    </div>
  );
}

// One side (in/out) of a clip's transition: a kind picker (none + the gallery)
// and, once a kind is chosen, a length slider. Writes transIn/transInDur or
// transOut/transOutDur so the compositor's existing push/opacity ramps pick it up.
const TRANS_EASE_KINDS: EaseKind[] = ['ease-out', 'ease-in', 'linear', 'ease-in-out', 'bounce', 'elastic', 'back'];
const TRANS_EASE_LABELS: Record<string, string> = {
  'ease-out': 'Ease Out', 'ease-in': 'Ease In', 'linear': 'Linear',
  'ease-in-out': 'S-Curve', 'bounce': 'Bounce', 'elastic': 'Spring', 'back': 'Back',
};

function TransRow({ label, side, clip, commit }: {
  label: string; side: 'in' | 'out'; clip: Clip; commit: (p: Partial<Clip>) => void;
}) {
  const kind = (side === 'in' ? clip.transIn : clip.transOut) ?? 'none';
  const dur = (side === 'in' ? clip.transInDur : clip.transOutDur) ?? DEFAULT_TRANS_DUR;
  const ease = (side === 'in' ? clip.transInEase : clip.transOutEase) ?? (side === 'in' ? 'ease-out' : 'ease-in');
  const maxDur = Math.max(0.2, Math.min(3, clip.duration));

  const setKind = (k: TransitionKind) => {
    const nextDur = k !== 'none' && (dur ?? 0) > 0 ? Math.min(dur, maxDur) : Math.min(DEFAULT_TRANS_DUR, maxDur);
    commit(side === 'in'
      ? { transIn: k, transInDur: nextDur }
      : { transOut: k, transOutDur: nextDur });
  };
  const setDur = (d: number) => commit(side === 'in' ? { transInDur: d } : { transOutDur: d });
  const setEase = (e: EaseKind) => commit(side === 'in' ? { transInEase: e } : { transOutEase: e });

  return (
    <div className="trans-row">
      <div className="trans-row-head">
        <span className="insp-label">{label}</span>
        <span className="trans-chips">
          <button
            type="button"
            className={`trans-chip${kind === 'none' ? ' on' : ''}`}
            title="No transition"
            onClick={() => setKind('none')}
          >Off</button>
          {ALL_TRANSITIONS.map((t) => (
            <button
              key={t.kind}
              type="button"
              className={`trans-chip${kind === t.kind ? ' on' : ''}`}
              title={t.label}
              aria-label={t.label}
              onClick={() => setKind(t.kind)}
            ><TransIcon kind={t.kind} size={14} /></button>
          ))}
        </span>
      </div>
      {kind !== 'none' && (
        <>
          <div className="insp-slider compact">
            <div className="insp-slider-head">
              <span className="insp-sub">Length</span>
              <span className="insp-val">{Math.min(dur, maxDur).toFixed(1)}s</span>
            </div>
            <input type="range" min={0.1} max={maxDur} step={0.1} value={Math.min(dur, maxDur)}
              onChange={(e) => setDur(parseFloat(e.target.value))} />
          </div>
          <div className="trans-ease-row">
            <span className="insp-sub">Easing</span>
            <div className="kf-ease-row" style={{ flex: 1 }}>
              {TRANS_EASE_KINDS.map((e) => (
                <button key={e} type="button"
                  className={`kf-ease-btn${ease === e ? ' active' : ''}`}
                  title={TRANS_EASE_LABELS[e]}
                  onClick={() => setEase(e)}
                ><EaseCurve kind={e} /></button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Push transitions used to live here as an Inspector group, but they now belong
// to the Media panel's Transitions library — drag one onto a clip's start or end
// on the timeline, then click the on-clip badge to tune its length or remove it.

// The audio window: a dedicated editor for audio-only clips and detached video
// sound, kept separate from visual transform/filter controls.
export function AudioPanel() {
  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedClipId) || null);
  const isAudioClip = useStore((s) => {
    const c = s.clips.find((x) => x.id === s.selectedClipId);
    return !!c && (c.audioOnly || s.assets.find((a) => a.id === c.assetId)?.kind === 'audio');
  });
  const tracks = useStore((s) => s.project.tracks);
  const playhead = useStore((s) => s.playhead);
  const rawCommit = useClipCommit();

  const canSplit = clip != null && playhead > clip.start + 0.2 && playhead < clip.start + clip.duration - 0.2;

  if (!clip || !isAudioClip) {
    return (
      <div className="inspector empty">
        <p className="empty-title">No audio selected</p>
        <p className="empty-sub">Select an audio clip to edit its timing, volume, and fades here.</p>
      </div>
    );
  }

  const commit = (patch: Partial<Clip>) => rawCommit(clip.id, patch);
  const maxDur = clip.loop ? 3600 : Math.max(0.2, clip.sourceDuration - clip.inPoint);
  const volumePct = Math.round((clip.volume ?? 1) * 100);

  return (
    <div className="inspector audio-inspector">
      <div className="insp-head">
        <span className="insp-swatch audio" />
        <span className="insp-name">{clip.name}</span>
      </div>

      <div className="insp-actions">
        <button className="btn sm" onClick={() => duplicateClip(clip)} title="Drop a copy after this audio clip">＋ Duplicate</button>
        <button className="btn sm" disabled={!canSplit} onClick={() => canSplit && splitClip(clip, playhead)} title="Cut in two at the playhead">✂ Split</button>
        <button className="btn danger sm" onClick={() => removeClip(clip)} title="Remove this audio clip">Delete</button>
      </div>

      <Group title="Clip">
        <Row label="Track">
          <select value={clip.trackId} onChange={(e) => commit({ trackId: e.target.value })}>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Row>
        <Num label="Start" value={clip.start} step={0.1} min={0} onChange={(v) => commit({ start: v })} unit="s" />
        <Num label="Duration" value={clip.duration} step={0.1} min={0.2} max={maxDur} onChange={(v) => commit({ duration: v })} unit="s" />
        <Num label="In point" value={clip.inPoint} step={0.1} min={0} max={clip.sourceDuration - 0.2} onChange={(v) => commit({ inPoint: v })} unit="s" />
        <p className="insp-note">source {clip.sourceDuration.toFixed(1)}s</p>
      </Group>

      <Group title="Audio">
        <Slider label="Volume" value={volumePct} min={0} max={200} step={1} onChange={(v) => commit({ volume: v / 100 })} unit="%" />
        <Row label="Mute">
          <input className="insp-check" type="checkbox" checked={!!clip.muted} onChange={(e) => commit({ muted: e.target.checked })} />
        </Row>
        <Row label="Loop">
          <input className="insp-check" type="checkbox" checked={!!clip.loop} onChange={(e) => commit({ loop: e.target.checked })} />
        </Row>
      </Group>

      <Group title="Fades">
        <Slider label="Fade in" value={clip.fadeIn} min={0} max={Math.min(4, clip.duration)} step={0.1} onChange={(v) => commit({ fadeIn: v })} unit="s" />
        <Slider label="Fade out" value={clip.fadeOut} min={0} max={Math.min(4, clip.duration)} step={0.1} onChange={(v) => commit({ fadeOut: v })} unit="s" />
      </Group>
    </div>
  );
}

// The text window: a dedicated editor for a title clip's words and styling, kept
// in its own dock window separate from the clip Inspector. Empty unless a text
// clip is selected.
export function TextPanel() {
  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedClipId) || null);
  const isTextClip = useStore((s) => {
    const c = s.clips.find((x) => x.id === s.selectedClipId);
    return !!c && s.assets.find((a) => a.id === c.assetId)?.kind === 'text';
  });
  const playhead = useStore((s) => s.playhead);
  const rawCommit = useClipCommit();

  const canSplit = clip != null && playhead > clip.start + 0.2 && playhead < clip.start + clip.duration - 0.2;

  if (!clip || !isTextClip) {
    return (
      <div className="inspector empty">
        <p className="empty-title">No text selected</p>
        <p className="empty-sub">Select a text clip to edit its words, size, and style here.</p>
      </div>
    );
  }

  const commit = (patch: Partial<Clip>) => rawCommit(clip.id, patch);

  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="insp-swatch" style={{ background: clip.color }} />
        <span className="insp-name">{clip.text?.split('\n')[0] || 'Text'}</span>
      </div>

      <div className="insp-actions">
        <button className="btn sm" onClick={() => duplicateClip(clip)} title="Drop a copy after this title">＋ Duplicate</button>
        <button className="btn sm" disabled={!canSplit} onClick={() => canSplit && splitClip(clip, playhead)} title="Cut in two at the playhead">✂ Split</button>
        <button className="btn danger sm" onClick={() => removeClip(clip)} title="Remove this title">Delete</button>
      </div>

      <Group title="Presets">
        <TextPresets clip={clip} onPick={(p) => commit(p)} />
        <p className="insp-note">Pick a look, then drag the text in the preview to place and scale it.</p>
      </Group>

      <Group title="Content">
        <textarea
          className="insp-textarea"
          value={clip.text ?? ''}
          rows={3}
          placeholder="Type your text…"
          onChange={(e) => commit({ text: e.target.value })}
        />
      </Group>

      <Group title="Style">
        <Row label="Font">
          <select
            className="font-select"
            value={clip.fontFamily ?? 'system'}
            style={{ fontFamily: (FONTS.find((f) => f.id === (clip.fontFamily ?? 'system')) ?? FONTS[0]).stack }}
            onChange={(e) => commit({ fontFamily: e.target.value })}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>{f.label}</option>
            ))}
          </select>
        </Row>
        <Slider label="Size" value={clip.fontSize ?? 64} min={12} max={220} step={1} onChange={(v) => commit({ fontSize: v })} unit="px" />
        <Row label="Color">
          <input
            type="color"
            className="insp-color"
            value={clip.fontColor ?? '#ffffff'}
            onChange={(e) => commit({ fontColor: e.target.value })}
          />
        </Row>
        <Row label="Align">
          <div className="seg">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                type="button"
                title={a[0].toUpperCase() + a.slice(1)}
                aria-label={`Align ${a}`}
                className={`seg-btn${(clip.align ?? 'center') === a ? ' on' : ''}`}
                onClick={() => commit({ align: a })}
              ><AlignIcon dir={a} /></button>
            ))}
          </div>
        </Row>
        <Row label="Weight">
          <div className="seg">
            {([['Regular', 400], ['Bold', 700]] as const).map(([lbl, w]) => (
              <button
                key={w}
                type="button"
                className={`seg-btn${(clip.fontWeight ?? 700) === w ? ' on' : ''}`}
                onClick={() => commit({ fontWeight: w })}
              >{lbl}</button>
            ))}
          </div>
        </Row>
        <Slider label="Rotation" value={clip.rotation ?? 0} min={-180} max={180} step={1} onChange={(v) => commit({ rotation: v })} unit="°" />
        <div className="rot-presets">
          {[-90, -45, 0, 45, 90].map((deg) => (
            <button
              key={deg}
              type="button"
              className={`rot-preset${(clip.rotation ?? 0) === deg ? ' on' : ''}`}
              onClick={() => commit({ rotation: deg })}
            >{deg === 0 ? '0°' : `${deg > 0 ? '+' : ''}${deg}°`}</button>
          ))}
        </div>
      </Group>
    </div>
  );
}

// ---- text presets -------------------------------------------------------
// Named title looks built from the props a text clip already persists
// (size / color / weight / align), so picking one is a single commit and the
// preview updates live — then the user can fine-tune by dragging in the frame.
interface TextPreset {
  key: string; name: string;
  fontSize: number; fontColor: string; fontWeight: number;
  align: 'left' | 'center' | 'right';
}

const TEXT_PRESETS: TextPreset[] = [
  { key: 'headline', name: 'Headline', fontSize: 104, fontColor: '#ffffff', fontWeight: 700, align: 'center' },
  { key: 'subtitle', name: 'Subtitle', fontSize: 50,  fontColor: '#ffffff', fontWeight: 400, align: 'center' },
  { key: 'caption',  name: 'Caption',  fontSize: 32,  fontColor: '#e5e7eb', fontWeight: 400, align: 'center' },
  { key: 'pop',      name: 'Pop',      fontSize: 96,  fontColor: '#ffd23f', fontWeight: 700, align: 'center' },
  { key: 'gold',     name: 'Gold',     fontSize: 72,  fontColor: '#d6a23a', fontWeight: 700, align: 'center' },
  { key: 'leadin',   name: 'Lead-in',  fontSize: 40,  fontColor: '#ffffff', fontWeight: 700, align: 'left' },
];

function TextPresets({ clip, onPick }: { clip: Clip; onPick: (p: Partial<Clip>) => void }) {
  const curSize = clip.fontSize ?? 64;
  const curColor = (clip.fontColor ?? '#ffffff').toLowerCase();
  const curWeight = clip.fontWeight ?? 700;
  const curAlign = clip.align ?? 'center';
  return (
    <div className="text-presets">
      {TEXT_PRESETS.map((p) => {
        const active = curSize === p.fontSize && curColor === p.fontColor.toLowerCase()
          && curWeight === p.fontWeight && curAlign === p.align;
        // shrink the real size into a legible tile sample so relative scale reads
        const sample = Math.round(Math.min(30, Math.max(13, p.fontSize * 0.26)));
        return (
          <button
            key={p.key}
            type="button"
            title={`${p.name} · ${p.fontSize}px`}
            className={`text-preset${active ? ' active' : ''}`}
            onClick={() => onPick({ fontSize: p.fontSize, fontColor: p.fontColor, fontWeight: p.fontWeight, align: p.align })}
          >
            <span className="tp-sample" style={{ color: p.fontColor, fontWeight: p.fontWeight, fontSize: sample, textAlign: p.align }}>Ag</span>
            <span className="tp-name">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- filter presets -----------------------------------------------------
type Grade = { brightness: number; saturation: number; contrast: number; temperature: number };
interface Preset { key: string; name: string; grade: Grade & { filter: string } }

const G = (brightness: number, saturation: number, contrast: number, temperature: number, key: string): Preset['grade'] =>
  ({ brightness, saturation, contrast, temperature, filter: key });

const FILTER_PRESETS: Preset[] = [
  { key: 'none',    name: 'Original', grade: G(1,    1,    1,    0,     'none') },
  { key: 'vivid',   name: 'Vivid',    grade: G(1.03, 1.45, 1.18, 0.05,  'vivid') },
  { key: 'warm',    name: 'Warm',     grade: G(1.04, 1.12, 1.04, 0.45,  'warm') },
  { key: 'cool',    name: 'Cool',     grade: G(1.0,  1.05, 1.06, -0.42, 'cool') },
  { key: 'bw',      name: 'B&W',      grade: G(1.02, 0,    1.22, 0,     'bw') },
  { key: 'noir',    name: 'Noir',     grade: G(0.9,  0,    1.5,  0,     'noir') },
  { key: 'sepia',   name: 'Sepia',    grade: G(1.05, 0.35, 1.06, 0.6,   'sepia') },
  { key: 'vintage', name: 'Vintage',  grade: G(1.02, 0.7,  0.88, 0.3,   'vintage') },
  { key: 'fade',    name: 'Faded',    grade: G(1.08, 0.78, 0.78, 0.08,  'fade') },
  { key: 'dream',   name: 'Dream',    grade: G(1.12, 1.2,  0.9,  0.12,  'dream') },
  { key: 'cyber',   name: 'Cyber',    grade: G(1.0,  1.35, 1.15, -0.55, 'cyber') },
  { key: 'sunset',  name: 'Sunset',   grade: G(1.05, 1.25, 1.08, 0.55,  'sunset') },
];

// CSS approximation of the WGSL grade, used for the thumbnail previews
function cssGrade(g: Grade): string {
  const parts = [`brightness(${g.brightness})`, `saturate(${g.saturation})`, `contrast(${g.contrast})`];
  if (g.temperature > 0.001) parts.push(`sepia(${Math.min(0.7, g.temperature * 0.7)})`);
  else if (g.temperature < -0.001) parts.push(`hue-rotate(${g.temperature * 22}deg)`);
  return parts.join(' ');
}

function FilterGallery({ active, grade, clip, assetKind, onPick }: {
  active: string; grade: Grade; clip: Clip; assetKind?: string; onPick: (p: Preset) => void;
}) {
  // a still of the clip's current frame so each tile previews real footage
  const frame = useClipFrame(clip, assetKind);
  const thumbBg = frame ? { backgroundImage: `url("${frame}")` } : null;
  return (
    <div className="filter-gallery">
      {FILTER_PRESETS.map((p) => {
        const isActive = active === p.key || (active === 'none' && p.key === 'none');
        return (
          <button
            key={p.key}
            type="button"
            className={`filter-tile${isActive ? ' active' : ''}`}
            onClick={() => onPick(p)}
            title={p.name}
          >
            <span className="filter-thumb" style={{ filter: cssGrade(p.grade), ...thumbBg }} />
            <span className="filter-name">{p.name}</span>
          </button>
        );
      })}
      {active === 'custom' && <span className="filter-custom-note">Custom — adjusted below</span>}
    </div>
  );
}

// Returns a data-URL still of the clip's frame at the playhead, so the filter
// tiles preview the actual footage. Images preview from their URL directly.
// When the playhead sits off the clip, falls back to the clip's first frame.
function useClipFrame(clip: Clip, assetKind?: string): string | null {
  const isVideo = assetKind === 'video';
  const isImage = assetKind === 'image';
  const src = clip.src ?? null;
  // quantize the playhead so we recapture ~8x/s, not on every animation frame
  const qHead = useStore((s) => Math.round(s.playhead * 8) / 8);

  // source time to grab, mirroring the compositor's loop/trim math; when the
  // playhead is off the clip, show its first (trimmed) frame
  let t = clip.inPoint;
  if (qHead >= clip.start && qHead < clip.start + clip.duration) {
    const local = qHead - clip.start;
    const period = clip.sourceDuration - clip.inPoint;
    t = clip.loop && period > 0.05 ? clip.inPoint + (local % period) : local + clip.inPoint;
  }
  const quant = Math.round(t * 8) / 8;

  const [frame, setFrame] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedSrcRef = useRef<string | null>(null);

  useEffect(() => {
    if (isImage) { setFrame(src); return; }
    if (!isVideo || !src) { setFrame(null); return; }
    let cancelled = false;

    let v = videoRef.current;
    if (!v) {
      v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous'; v.preload = 'auto';
      videoRef.current = v;
    }
    if (loadedSrcRef.current !== src) { v.src = src; loadedSrcRef.current = src; }
    const cv = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'));

    const grab = () => {
      if (cancelled || !v) return;
      const w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) return;
      const TW = 160, TH = Math.max(1, Math.round((TW * h) / w));
      cv.width = TW; cv.height = TH;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      try { ctx.drawImage(v, 0, 0, TW, TH); setFrame(cv.toDataURL('image/jpeg', 0.72)); } catch { /* frame not decodable yet */ }
    };
    const onSeeked = () => { v?.removeEventListener('seeked', onSeeked); grab(); };
    const seek = () => {
      if (cancelled || !v || v.readyState < 1) return;
      const dur = v.duration || quant;
      const target = Math.max(0, Math.min(quant, dur - 0.05));
      if (v.readyState >= 2 && Math.abs(v.currentTime - target) < 0.02) { grab(); return; }
      v.addEventListener('seeked', onSeeked);
      v.currentTime = target;
    };
    const onMeta = () => { v?.removeEventListener('loadeddata', onMeta); seek(); };

    if (v.readyState >= 1) seek();
    else v.addEventListener('loadeddata', onMeta);

    return () => {
      cancelled = true;
      v?.removeEventListener('seeked', onSeeked);
      v?.removeEventListener('loadeddata', onMeta);
    };
  }, [isVideo, isImage, src, quant]);

  return frame;
}

// Clear left/center/right alignment icon — three lines justified to match,
// replacing the ambiguous arrow glyphs that read as dashes at this size.
function AlignIcon({ dir }: { dir: 'left' | 'center' | 'right' }) {
  // each line: [width, x-start fraction] within a 14-wide box
  const rows = dir === 'left'
    ? [[12, 1], [8, 1], [11, 1]]
    : dir === 'right'
      ? [[12, 13], [8, 13], [11, 13]]
      : [[12, 7], [8, 7], [11, 7]];
  return (
    <svg className="align-ico" viewBox="0 0 14 12" width="14" height="12" aria-hidden="true">
      {rows.map(([w, anchor], i) => {
        const x1 = dir === 'left' ? anchor : dir === 'right' ? anchor - w : anchor - w / 2;
        const y = 2 + i * 4;
        return <line key={i} x1={x1} y1={y} x2={x1 + w} y2={y} />;
      })}
    </svg>
  );
}

const ALIGN_POS = [
  { x: -1, y:  1 }, { x: 0, y:  1 }, { x: 1, y:  1 },
  { x: -1, y:  0 }, { x: 0, y:  0 }, { x: 1, y:  0 },
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
];

function alignLabel(x: number, y: number) {
  const h = x < 0 ? 'Left' : x > 0 ? 'Right' : 'Center';
  const v = y > 0 ? 'Top' : y < 0 ? 'Bottom' : 'Middle';
  return `${v} ${h}`;
}

function AlignGrid({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  return (
    <div className="insp-row">
      <span className="insp-label">Position</span>
      <div className="align-grid">
        {ALIGN_POS.map((p) => {
          const active = Math.abs(x - p.x) < 0.05 && Math.abs(y - p.y) < 0.05;
          return (
            <button
              key={`${p.x},${p.y}`}
              type="button"
              className={`align-cell${active ? ' on' : ''}`}
              title={alignLabel(p.x, p.y)}
              onClick={() => onChange(p.x, p.y)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="insp-group">
      <h3 className="insp-group-title">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="insp-row">
      <span className="insp-label">{label}</span>
      {children}
    </label>
  );
}

function Num({ label, value, onChange, step, min, max, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  step: number; min?: number; max?: number; unit?: string;
}) {
  return (
    <Row label={label}>
      <span className="num-wrap">
        <input
          type="number" value={round(value)} step={step} min={min} max={max}
          onChange={(e) => onChange(clamp(parseFloat(e.target.value) || 0, min, max))}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </Row>
  );
}

function Slider({ label, value, onChange, step, min, max, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  step: number; min: number; max: number; unit?: string;
}) {
  return (
    <div className="insp-slider">
      <div className="insp-slider-head">
        <span className="insp-label">{label}</span>
        <span className="insp-val">{round(value)}{unit ?? ''}</span>
      </div>
      <input type="range" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

// ---- keyframes ----------------------------------------------------------
// A transform slider that can be animated. The diamond toggles a keyframe at the
// playhead; once a property has any keyframe, moving the slider authors a key at
// the current time and the displayed value follows the curve as you scrub. The
// chevrons jump the playhead between this property's keys.
export function KeyableSlider({ clip, meta, fps, playhead, commit, setPlayhead }: {
  clip: Clip; meta: KeyableMeta; fps: number; playhead: number;
  commit: (p: Partial<Clip>) => void; setPlayhead: (t: number) => void;
}) {
  const prop = meta.prop;
  const eps = 0.5 / (fps || 30);
  const onClip = playhead >= clip.start && playhead < clip.start + clip.duration;
  const local = clamp(playhead - clip.start, 0, clip.duration) as number;
  const animated = isAnimated(clip, prop);
  const keys = kfFor(clip, prop);
  const staticVal = (clip[prop] as number | undefined) ?? meta.fallback;
  const value = animated ? evalProp(clip, prop, local, meta.fallback) : staticVal;
  const atKey = animated ? keyframeAt(clip, prop, local, eps) : null;

  const setProp = (v: number) => commit({ [prop]: v } as Partial<Clip>);

  const onChange = (v: number) => {
    if (animated) commit({ keyframes: upsertKeyframe(clip, prop, local, v, eps) });
    else setProp(v);
  };

  // diamond: add a key at the playhead, or remove the one already there.
  const toggleKey = () => {
    if (atKey) {
      const remaining = removeKeyframe(clip, atKey.id);
      const stillAnimated = remaining.some((k) => k.prop === prop);
      const patch: Partial<Clip> = { keyframes: remaining };
      // baking the last key's value into the static field avoids a jump when the
      // property stops being animated
      if (!stillAnimated) (patch as Record<string, unknown>)[prop] = atKey.value;
      commit(patch);
    } else {
      commit({ keyframes: upsertKeyframe(clip, prop, local, value, eps) });
    }
  };

  const jump = (dir: -1 | 1) => {
    const t = adjacentKeyframeTime(clip, prop, local, dir, eps);
    if (t != null) setPlayhead(clip.start + t);
  };

  const prevT = animated ? adjacentKeyframeTime(clip, prop, local, -1, eps) : null;
  const nextT = animated ? adjacentKeyframeTime(clip, prop, local, 1, eps) : null;
  const diamondCls = atKey ? 'on' : animated ? 'mid' : '';

  return (
    <div className={`insp-slider keyable${animated ? ' animated' : ''}`}>
      <div className="insp-slider-head">
        <button
          type="button"
          className={`kf-toggle ${diamondCls}`}
          title={atKey ? 'Remove keyframe here' : animated ? 'Add keyframe here' : 'Animate this property — add a keyframe'}
          aria-label="Toggle keyframe"
          disabled={!onClip}
          onClick={toggleKey}
        >
          <Diamond />
        </button>
        <span className="insp-label">{meta.label}</span>
        {animated && (
          <span className="kf-nav">
            <button type="button" className="kf-step" disabled={prevT == null} title="Previous keyframe" onClick={() => jump(-1)}>‹</button>
            <span className="kf-count" title={`${keys.length} keyframe${keys.length === 1 ? '' : 's'}`}>{keys.length}</span>
            <button type="button" className="kf-step" disabled={nextT == null} title="Next keyframe" onClick={() => jump(1)}>›</button>
          </span>
        )}
        <span className="insp-val">{round(value)}{meta.unit ?? ''}</span>
      </div>
      <input
        type="range" value={value} min={meta.min} max={meta.max} step={meta.step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {atKey && (
        <div className="kf-ease-row">
          {(['ease-in', 'ease', 'ease-out', 'linear', 'hold'] as EaseKind[]).map((e) => (
            <button
              key={e}
              type="button"
              className={`kf-ease-btn${(atKey.ease ?? 'ease') === e ? ' active' : ''}`}
              title={e}
              onClick={() => commit({ keyframes: setKeyframeEase(clip, atKey.id, e) })}
            >
              <EaseCurve kind={e} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EaseCurve({ kind }: { kind: EaseKind }) {
  const paths: Record<EaseKind, string> = {
    'ease-in':     'M 0 12 C 1 12 12 3 12 0',
    'ease':        'M 0 12 C 4 12 8 0 12 0',
    'ease-out':    'M 0 12 C 0 9 11 0 12 0',
    'ease-in-out': 'M 0 12 C 3 12 9 0 12 0',
    'linear':      'M 0 12 L 12 0',
    'hold':        'M 0 12 L 9 12 L 9 0 L 12 0',
    'bounce':      'M 0 12 L 6 0 L 7.5 3.5 L 9.5 0.5 L 12 0',
    'elastic':     'M 0 12 C 3 12 2 -3 6 -3 C 9 -3 10 1 12 0',
    'back':        'M 0 12 C 5 12 12 -2 12 0',
  };
  return (
    <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
      <path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Diamond() {
  return (
    <svg className="kf-diamond" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M6 1 L11 6 L6 11 L1 6 Z" />
    </svg>
  );
}

// A compact lane under the transform sliders: the clip's life with a diamond at
// every keyframe time and a marker for the playhead. Click to scrub to a time;
// shows only when the clip actually has keyframes.
export function KeyframeTrack({ clip, playhead, setPlayhead }: {
  clip: Clip; playhead: number; setPlayhead: (t: number) => void;
}) {
  const times = keyframeTimes(clip);
  if (times.length === 0) return null;
  const dur = Math.max(0.001, clip.duration);
  const headLocal = playhead - clip.start;
  const headPct = headLocal >= 0 && headLocal <= dur ? (headLocal / dur) * 100 : null;

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1) as number;
    setPlayhead(clip.start + f * dur);
  };

  return (
    <div className="kf-track" onPointerDown={scrub} title="Keyframes — click to scrub">
      <div className="kf-track-line" />
      {headPct != null && <div className="kf-track-head" style={{ left: `${headPct}%` }} />}
      {times.map((t, i) => (
        <span key={i} className="kf-track-dot" style={{ left: `${(t / dur) * 100}%` }} />
      ))}
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, min?: number, max?: number) => {
  let x = v;
  if (min !== undefined) x = Math.max(min, x);
  if (max !== undefined) x = Math.min(max, x);
  return x;
};

// Visual post-effects panel: blur, vignette, grain, pixelate. Available for any
// clip; effects stack on top of the color grade.
export function EffectsPanel() {
  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedClipId) || null);
  const rawCommit = useClipCommit();

  if (!clip) {
    return (
      <div className="inspector empty">
        <p className="empty-title">No clip selected</p>
        <p className="empty-sub">Select a clip on the timeline to add blur, vignette, grain, and pixelate effects.</p>
      </div>
    );
  }

  const commit = (patch: Partial<Clip>) => rawCommit(clip.id, patch);
  const blurPct     = Math.round((clip.blur     ?? 0) * 100);
  const vignettePct = Math.round((clip.vignette ?? 0) * 100);
  const grainPct    = Math.round((clip.grain    ?? 0) * 100);
  const pixelatePct = Math.round((clip.pixelate ?? 0) * 100);

  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="insp-swatch" style={{ background: clip.color }} />
        <span className="insp-name">{clip.name}</span>
      </div>
      <Group title="Effects">
        <Slider label="Blur"     value={blurPct}     min={0} max={100} step={1} onChange={(v) => commit({ blur:     v / 100 })} unit="%" />
        <Slider label="Vignette" value={vignettePct} min={0} max={100} step={1} onChange={(v) => commit({ vignette: v / 100 })} unit="%" />
        <Slider label="Grain"    value={grainPct}    min={0} max={100} step={1} onChange={(v) => commit({ grain:    v / 100 })} unit="%" />
        <Slider label="Pixelate" value={pixelatePct} min={0} max={100} step={1} onChange={(v) => commit({ pixelate: v / 100 })} unit="%" />
      </Group>
      <p className="insp-note" style={{ padding: '0 0 8px' }}>0% = off. Effects stack on top of the color grade.</p>
    </div>
  );
}
