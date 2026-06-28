import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import {
  ALL_TRANSITIONS,
  TransIcon as TransGlyph,
  TRANS_DND_TYPE,
  DEFAULT_TRANS_DUR,
} from '../transitions';
import type { Asset, Clip, TransitionKind } from '../types';
import { KEYABLE, KEYABLE_FILTERS } from '../keyframes';
import { useClipCommit, KeyableSlider, KeyframeTrack } from './Inspector';

// Filmora-style left library: a vertical icon rail picks a category, the panel
// beside it shows that category's contents. Media/Audio/Titles browse the
// project's assets (drag a tile onto a track); Transitions are applied to the
// selected clip and can also be dragged onto a clip, which the timeline's drop
// handler consumes via TRANS_DND_TYPE.
type Category = 'media' | 'audio' | 'titles' | 'transitions';

// ---- rail icons defined first so CATS can reference them ----
function MediaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function AudioIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </svg>
  );
}
function TitleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7V5h14v2M12 5v14M9 19h6" />
    </svg>
  );
}
function TransIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="7" height="12" rx="1.5" />
      <rect x="14" y="6" width="7" height="12" rx="1.5" />
      <path d="M11 12h2M12 9l1.5 3L12 15" />
    </svg>
  );
}
function KeyframesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4 L20 12 L12 20 L4 12 Z" />
      <line x1="2" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="22" y2="12" />
    </svg>
  );
}

const CATS: { id: Category; label: string; icon: JSX.Element }[] = [
  { id: 'media', label: 'Media', icon: <MediaIcon /> },
  { id: 'audio', label: 'Audio', icon: <AudioIcon /> },
  { id: 'titles', label: 'Titles', icon: <TitleIcon /> },
  { id: 'transitions', label: 'Transitions', icon: <TransIcon /> },
];

// static bar heights (%) for the audio-tile waveform glyph
const WAVE = [28, 52, 38, 74, 46, 88, 60, 40, 70, 34, 56, 44, 80, 50, 30];

export function Library() {
  const [cat, setCat] = useState<Category>('media');

  return (
    <div className="library">
      <nav className="lib-rail" aria-label="Library categories">
        {CATS.map((c) => (
          <button
            key={c.id}
            className={`lib-tab ${cat === c.id ? 'on' : ''}`}
            onClick={() => setCat(c.id)}
            title={c.label}
          >
            <span className="lib-ico">{c.icon}</span>
            <span className="lib-tab-label">{c.label}</span>
          </button>
        ))}
      </nav>
      <div className="lib-content">
        {cat === 'media' && <AssetGrid kinds={['video', 'image']} accept="video/*,image/*" emptyHint="Import video or images to get started." />}
        {cat === 'audio' && <AssetGrid kinds={['audio']} accept="audio/*" emptyHint="Import music or sound effects." />}
        {cat === 'titles' && <TitlesPanel />}
        {cat === 'transitions' && <TransitionsLibrary />}
      </div>
    </div>
  );
}

// ---- Media / Audio: browse + import + drag onto a track ----
function AssetGrid({ kinds, accept, emptyHint }: { kinds: Asset['kind'][]; accept: string; emptyHint: string }) {
  const assets = useStore((s) => s.assets);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const shown = assets.filter((a) => kinds.includes(a.kind));

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        const meta = await readMediaMeta(file);
        await api.uploadAsset(file, meta);
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="lib-panel">
      <div className="lib-head">
        <h2>{kinds.includes('audio') ? 'Audio' : 'Media'}</h2>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : '＋ Import'}
        </button>
        <input ref={fileRef} type="file" accept={accept} multiple hidden onChange={onUpload} />
      </div>
      {shown.length === 0 ? (
        <div className="lib-empty"><p>{emptyHint}</p></div>
      ) : (
        <div className="bin-grid">
          {shown.map((a) => <AssetTile key={a.id} a={a} />)}
        </div>
      )}
      {shown.length > 0 && <p className="hint">Drag a clip onto a track.</p>}
    </div>
  );
}

function AssetTile({ a }: { a: Asset }) {
  return (
    <div
      className="bin-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-deckstop-asset', a.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`${a.name} · ${a.duration.toFixed(1)}s`}
    >
      <div className="bin-thumb" style={thumbStyle(a)}>
        {a.kind === 'image' && a.url && <img src={a.url} alt="" />}
        {a.kind === 'video' && a.url && (
          <>
            <video src={`${a.url}#t=0.1`} muted preload="metadata" playsInline />
            <span className="thumb-tag">▶ video</span>
          </>
        )}
        {a.kind === 'audio' && (
          <>
            <div className="audio-wave" aria-hidden>
              {WAVE.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
            </div>
            <span className="thumb-tag">♪ audio</span>
          </>
        )}
        {a.kind === 'text' && (
          <>
            <span className="text-glyph" aria-hidden>T</span>
            <span className="thumb-tag">T text</span>
          </>
        )}
      </div>
      <div className="bin-meta">
        <span className="bin-name">{a.name}</span>
        <span className="bin-dur">{a.kind === 'text' ? 'Title' : `${a.duration.toFixed(1)}s`}</span>
      </div>
    </div>
  );
}

// ---- Titles: a few ready-made title styles + existing text assets ----
const TITLE_PRESETS: { label: string; text: string; fontSize: number; weight: number }[] = [
  { label: 'Headline', text: 'HEADLINE', fontSize: 96, weight: 800 },
  { label: 'Subtitle', text: 'Subtitle goes here', fontSize: 48, weight: 500 },
  { label: 'Lower third', text: 'Name · Role', fontSize: 40, weight: 600 },
  { label: 'Caption', text: 'Add a caption', fontSize: 36, weight: 400 },
];

function TitlesPanel() {
  const assets = useStore((s) => s.assets);
  const texts = assets.filter((a) => a.kind === 'text');

  const addTitle = async (p: typeof TITLE_PRESETS[number]) => {
    const { asset } = await api.addText({ name: p.label, text: p.text });
    const st = useStore.getState();
    const top = st.project.tracks[0];
    if (!top) return;
    const { clip } = await api.addClip({ assetId: asset.id, trackId: top.id, start: st.playhead, duration: 4 });
    // carry the preset's look onto the dropped title
    await api.patchClip(clip.id, { fontSize: p.fontSize, fontWeight: p.weight, text: p.text });
    st.upsertClipLocal({ ...clip, fontSize: p.fontSize, fontWeight: p.weight, text: p.text });
    st.select(clip.id);
  };

  return (
    <div className="lib-panel">
      <div className="lib-head"><h2>Titles</h2></div>
      <div className="title-presets">
        {TITLE_PRESETS.map((p) => (
          <button key={p.label} className="title-preset" onClick={() => addTitle(p)}>
            <span className="tp-glyph" style={{ fontWeight: p.weight }}>{p.label === 'Headline' ? 'Aa' : 'T'}</span>
            <span className="tp-label">{p.label}</span>
          </button>
        ))}
      </div>
      {texts.length > 0 && (
        <>
          <p className="lib-subhead">In this project</p>
          <div className="bin-grid">
            {texts.map((a) => <AssetTile key={a.id} a={a} />)}
          </div>
          <p className="hint">Drag a title onto a track.</p>
        </>
      )}
    </div>
  );
}

// ---- Transitions: drag onto a clip, or apply to the selected clip edge ----
function TransitionsLibrary() {
  const selId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const sel = clips.find((c) => c.id === selId) ?? null;

  const apply = (kind: TransitionKind, side: 'in' | 'out') => {
    if (!sel) return;
    const patch = (side === 'in'
      ? { transIn: kind, transInDur: DEFAULT_TRANS_DUR }
      : { transOut: kind, transOutDur: DEFAULT_TRANS_DUR }) as Partial<Clip>;
    useStore.getState().patchClipLocal(sel.id, patch);
    api.patchClip(sel.id, patch).catch(() => {});
  };

  return (
    <div className="lib-panel transition-panel">
      <div className="lib-head transition-head">
        <h2>Transitions</h2>
        <span className={`transition-target ${sel ? 'on' : ''}`}>{sel ? 'Clip selected' : 'No clip'}</span>
      </div>
      <div className="transition-list">
        {ALL_TRANSITIONS.map((t) => {
          const activeIn = sel?.transIn === t.kind;
          const activeOut = sel?.transOut === t.kind;
          return (
          <div
            key={t.kind}
            className={`transition-card kind-${t.kind}${activeIn || activeOut ? ' active' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TRANS_DND_TYPE, t.kind);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title={t.label}
          >
            <span className="transition-preview" aria-hidden="true">
              <span className="preview-before" />
              <span className="preview-after" />
              <span className="preview-icon"><TransGlyph kind={t.kind} size={18} /></span>
            </span>
            <span className="transition-copy">
              <span className="transition-name">{t.label}</span>
              <span className="transition-short">{t.short}</span>
            </span>
            <span className="transition-actions">
              <button
                type="button"
                className={activeIn ? 'on' : ''}
                disabled={!sel}
                onClick={() => apply(t.kind, 'in')}
              >In</button>
              <button
                type="button"
                className={activeOut ? 'on' : ''}
                disabled={!sel}
                onClick={() => apply(t.kind, 'out')}
              >Out</button>
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function thumbStyle(a: { kind: string; hue?: number; color?: string }): React.CSSProperties {
  if (a.kind === 'image' || a.kind === 'video') return {};
  if (a.kind === 'audio') return { background: '#14302a' };
  if (a.kind === 'text') return { background: '#1c1a12' };
  const h = a.hue ?? 210;
  return { background: `hsl(${h} 45% 38%)` };
}

// read duration + dimensions client-side so the bin and trims are accurate
function readMediaMeta(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (m: { duration: number; width: number; height: number }) => {
      URL.revokeObjectURL(url);
      resolve(m);
    };
    if (file.type.startsWith('video')) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => done({ duration: v.duration || 10, width: v.videoWidth, height: v.videoHeight });
      v.onerror = () => done({ duration: 10, width: 1280, height: 720 });
      v.src = url;
    } else if (file.type.startsWith('audio')) {
      const au = document.createElement('audio');
      au.preload = 'metadata';
      au.onloadedmetadata = () => done({ duration: au.duration || 10, width: 0, height: 0 });
      au.onerror = () => done({ duration: 10, width: 0, height: 0 });
      au.src = url;
    } else {
      const img = new Image();
      img.onload = () => done({ duration: 6, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({ duration: 6, width: 1280, height: 720 });
      img.src = url;
    }
  });
}

// ---- keyframes panel ------------------------------------------------
// Shows all keyable properties (transform + color grade) for the selected clip
// with animated diamond toggles, so you can author keyframes without switching
// to the Inspector. Empty state guides you to select a clip first.
function KeyframesPanel() {
  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedClipId) || null);
  const assetKind = useStore((s) => {
    const c = s.clips.find((x) => x.id === s.selectedClipId);
    return c ? s.assets.find((a) => a.id === c.assetId)?.kind : undefined;
  });
  const playhead = useStore((s) => s.playhead);
  const fps = useStore((s) => s.project.fps);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const rawCommit = useClipCommit();

  if (!clip) {
    return (
      <div className="lib-panel">
        <div className="lib-empty"><p>Select a clip on the timeline to edit its keyframes.</p></div>
      </div>
    );
  }

  const commit = (patch: Partial<Clip>) => rawCommit(clip.id, patch);
  const isAudio = clip.audioOnly || assetKind === 'audio';
  const isText = assetKind === 'text';
  const clipLabel = isText ? (clip.text?.split('\n')[0] || 'Text') : clip.name;

  return (
    <div className="lib-panel kf-lib-panel">
      <div className="lib-head">
        <h2>Keyframes</h2>
        <span className="kf-lib-clip">{clipLabel}</span>
      </div>
      <div className="kf-lib-scroll">
        {!isAudio && (
          <>
            <p className="lib-subhead">Transform</p>
            <div className="kf-lib-group">
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
            </div>
            <KeyframeTrack clip={clip} playhead={playhead} setPlayhead={setPlayhead} />
          </>
        )}
        {!isAudio && !isText && (
          <>
            <p className="lib-subhead">Color</p>
            <div className="kf-lib-group">
              {KEYABLE_FILTERS.map((meta) => (
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
            </div>
          </>
        )}
        {isAudio && (
          <div className="lib-empty" style={{ flex: 'none', padding: '20px 16px' }}>
            <p>Audio clips don't have visual keyframes.</p>
          </div>
        )}
      </div>
    </div>
  );
}

