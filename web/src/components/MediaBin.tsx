import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { PUSH_TRANSITIONS, PushIcon, TRANS_DND_TYPE } from '../transitions';

// static bar heights (%) for the audio-tile waveform glyph
const WAVE = [28, 52, 38, 74, 46, 88, 60, 40, 70, 34, 56, 44, 80, 50, 30];

export function MediaBin() {
  const assets = useStore((s) => s.assets);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // bin filter: All shows every asset, Text shows only text overlays,
  // Transitions shows the draggable push-slide library (not project media)
  const [view, setView] = useState<'all' | 'text' | 'transitions'>('all');

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

  // Add Text: create a text asset (it stays in the bin to re-use) and drop a
  // title clip onto the top track at the playhead so it's ready to edit.
  const onAddText = async () => {
    const { asset } = await api.addText({ name: 'Text', text: 'Your text' });
    const st = useStore.getState();
    const top = st.project.tracks[0];
    if (top) {
      const { clip } = await api.addClip({ assetId: asset.id, trackId: top.id, start: st.playhead, duration: 4 });
      st.upsertClipLocal(clip);
      st.select(clip.id);
    }
  };

  const shown = view === 'text' ? assets.filter((a) => a.kind === 'text') : assets;

  return (
    <aside className="panel mediabin">
      <div className="panel-head">
        <h2>Media</h2>
        <div className="panel-actions">
          <button className="btn" onClick={onAddText} title="Add a text overlay">Text</button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Import'}
          </button>
          <input ref={fileRef} type="file" accept="video/*,audio/*,image/*" multiple hidden onChange={onUpload} />
        </div>
      </div>
      <div className="bin-tabs">
        <button className={`bin-tab ${view === 'all' ? 'on' : ''}`} onClick={() => setView('all')}>All</button>
        <button className={`bin-tab ${view === 'text' ? 'on' : ''}`} onClick={() => setView('text')}>Text</button>
        <button className={`bin-tab ${view === 'transitions' ? 'on' : ''}`} onClick={() => setView('transitions')}>Transitions</button>
      </div>
      {view === 'transitions' ? (
        <TransitionLibrary />
      ) : shown.length === 0 ? (
        <div className="bin-empty">
          {view === 'text' ? (
            <>
              <span className="bin-empty-glyph" aria-hidden>T</span>
              <p>No text overlays yet.</p>
              <button className="btn" onClick={onAddText}>Add text</button>
            </>
          ) : (
            <p>Import media to get started.</p>
          )}
        </div>
      ) : (
      <div className="bin-grid">
        {shown.map((a) => (
          <div
            key={a.id}
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
              <span className="bin-dur">{a.kind === 'text' ? 'Text' : `${a.duration.toFixed(1)}s`}</span>
            </div>
          </div>
        ))}
      </div>
      )}
      {view !== 'transitions' && shown.length > 0 && (
        <p className="hint">{view === 'text' ? 'Drag a title onto a track.' : 'Drag a clip onto a track.'}</p>
      )}
    </aside>
  );
}

// The transitions library (Filmora-style): a gallery of draggable push slides.
// Drag a tile onto a clip on the timeline — drop on its left half for an entry
// transition, its right half for an exit. The mini frame slides on hover to
// preview the direction the picture travels.
function TransitionLibrary() {
  return (
    <>
      <div className="bin-grid trans-grid">
        {PUSH_TRANSITIONS.map((t) => (
          <button
            key={t.kind}
            type="button"
            className="trans-tile"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TRANS_DND_TYPE, t.kind);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title={`${t.label} — drag onto a clip's start or end`}
          >
            <span className={`trans-demo dir-${t.short.toLowerCase()}`} aria-hidden>
              <span className="trans-demo-out" />
              <span className="trans-demo-in" />
              <span className="trans-demo-arrow"><PushIcon kind={t.kind} size={18} /></span>
            </span>
            <span className="trans-name">{t.label}</span>
          </button>
        ))}
      </div>
      <p className="hint">Drag onto the start or end of a clip.</p>
    </>
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
