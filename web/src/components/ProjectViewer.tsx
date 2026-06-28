import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { fontStack } from '../fonts';
import { buildLayers } from './Preview';
import type { ProjectSummary } from '../types';
import type { Layer } from '../webgpu/renderer';
import { BlueCaffeLogo } from './BlueCaffeLogo';

// Deckstop's start screen: a Filmora-style project launcher. A left rail to
// create, a header with search / sort / view toggle, and a gallery of every
// project you can jump straight into. This is the surface the app opens on.

type Sort = 'recent' | 'created' | 'name' | 'clips';
type Layout = 'grid' | 'list';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Last edited' },
  { id: 'created', label: 'Date created' },
  { id: 'name', label: 'Name' },
  { id: 'clips', label: 'Most clips' },
];

// Canvas presets offered when starting a new project — the aspect choices a
// video editor expects. Stored as real pixel dims so the compositor frames it.
const PRESETS: { key: string; label: string; sub: string; w: number; h: number }[] = [
  { key: '16:9', label: 'Landscape', sub: '16:9 · 1920×1080', w: 1920, h: 1080 },
  { key: '9:16', label: 'Portrait', sub: '9:16 · 1080×1920', w: 1080, h: 1920 },
  { key: '1:1', label: 'Square', sub: '1:1 · 1080×1080', w: 1080, h: 1080 },
  { key: '4:5', label: 'Social', sub: '4:5 · 1080×1350', w: 1080, h: 1350 },
  { key: '21:9', label: 'Cinema', sub: '21:9 · 2560×1080', w: 2560, h: 1080 },
];

export function ProjectViewer() {
  const projects = useStore((s) => s.projects);
  const currentId = useStore((s) => s.currentProjectId);
  const connected = useStore((s) => s.connected);
  const setView = useStore((s) => s.setView);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [layout, setLayout] = useState<Layout>('grid');
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => !q || p.name.toLowerCase().includes(q));
    const byTime = (a?: string, b?: string) => (b || '').localeCompare(a || '');
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'clips') return b.clipCount - a.clipCount;
      if (sort === 'created') return byTime(a.createdAt, b.createdAt);
      return byTime(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt);
    });
  }, [projects, query, sort]);

  // Open an existing project on the server, then drop into the editor. The
  // already-current project skips the round-trip.
  const open = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (id !== currentId) await api.openProject(id);
      setView('editor');
    } catch {
      setBusy(false);
    }
  };

  const create = async (w: number, h: number, name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.addProject({ name: name.trim() || 'Untitled', width: w, height: h, fps: 30 });
      setView('editor');
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <aside className="home-rail">
        <div className="home-brand">
          <BlueCaffeLogo size={24} />
          <span className="brand-name">BlueCaffe</span>
        </div>
        <button className="rail-new" onClick={() => setNewOpen(true)} disabled={busy}>
          <span className="rail-new-plus">＋</span> New project
        </button>
        <nav className="rail-nav">
          <span className="rail-link on"><GridGlyph /> Projects</span>
        </nav>
      </aside>

      <main className="home-main">
        <header className="home-head">
          <div className="home-title">
            <h1>Your projects</h1>
            <p>{projects.length} project{projects.length === 1 ? '' : 's'} · pick up where you left off</p>
          </div>
          <div className="home-tools">
            <label className="home-search">
              <SearchGlyph />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
              />
            </label>
            <select className="home-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <div className="home-layout" role="group" aria-label="Layout">
              <button className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')} title="Grid"><GridGlyph /></button>
              <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')} title="List"><ListGlyph /></button>
            </div>
          </div>
        </header>

        {layout === 'grid' ? (
          <div className="home-grid">
            <button className="new-card" onClick={() => setNewOpen(true)} disabled={busy}>
              <span className="new-card-plus">＋</span>
              <span className="new-card-label">New project</span>
              <span className="new-card-sub">Start a fresh timeline</span>
            </button>
            {shown.map((p) => (
              <ProjectCard key={p.id} p={p} current={p.id === currentId} busy={busy} onOpen={() => open(p.id)} canDelete={projects.length > 1} />
            ))}
          </div>
        ) : (
          <div className="home-list">
            {shown.map((p) => (
              <ProjectRow key={p.id} p={p} current={p.id === currentId} busy={busy} onOpen={() => open(p.id)} canDelete={projects.length > 1} />
            ))}
          </div>
        )}

        {shown.length === 0 && (
          <div className="home-empty">
            <p>{query ? `No projects match “${query}”.` : 'No projects yet.'}</p>
            {!query && <button className="btn primary" onClick={() => setNewOpen(true)}>Create your first project</button>}
          </div>
        )}
      </main>

      {newOpen && <NewProjectDialog busy={busy} onClose={() => setNewOpen(false)} onCreate={create} />}
    </div>
  );
}

// ---- one project, as a gallery card ----
function ProjectCard({ p, current, busy, onOpen, canDelete }: CardProps) {
  const { renaming, draft, setDraft, startRename, commitRename, cancelRename, duplicate, remove } = useProjectActions(p, canDelete);

  return (
    <div className={`pc${current ? ' current' : ''}`}>
      <button className="pc-thumb" onClick={onOpen} disabled={busy} title={`Open ${p.name}`}>
        <Poster p={p} />
        {current && <span className="pc-badge live">Open now</span>}
        <span className="pc-badge res">{aspectLabel(p)}</span>
        <span className="pc-clips">{p.clipCount} clip{p.clipCount === 1 ? '' : 's'}</span>
        <span className="pc-open"><PlayGlyph /> Open</span>
      </button>
      <div className="pc-info">
        {renaming ? (
          <input
            className="pc-rename"
            value={draft}
            autoFocus
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
            onBlur={commitRename}
          />
        ) : (
          <span className="pc-name" title={p.name}>{p.name}</span>
        )}
        <span className="pc-meta">{relTime(p.updatedAt || p.createdAt)} · {p.width}×{p.height}</span>
        <div className="pc-actions">
          <button onClick={startRename} disabled={busy} title="Rename">Rename</button>
          <button onClick={duplicate} disabled={busy} title="Duplicate">Duplicate</button>
          <button className="danger" onClick={remove} disabled={busy || !canDelete} title={canDelete ? 'Delete' : 'Keep at least one project'}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ---- one project, as a list row ----
function ProjectRow({ p, current, busy, onOpen, canDelete }: CardProps) {
  const { renaming, draft, setDraft, startRename, commitRename, cancelRename, duplicate, remove } = useProjectActions(p, canDelete);
  return (
    <div className={`pr${current ? ' current' : ''}`}>
      <button className="pr-open" onClick={onOpen} disabled={busy}>
        <span className="pr-thumb"><Poster p={p} /></span>
        <span className="pr-main">
          {renaming ? (
            <input
              className="pc-rename"
              value={draft}
              autoFocus
              maxLength={80}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
              onBlur={commitRename}
            />
          ) : (
            <span className="pr-name">{p.name}{current && <span className="pr-tag">Open now</span>}</span>
          )}
          <span className="pr-meta">{relTime(p.updatedAt || p.createdAt)} · {p.width}×{p.height} · {aspectLabel(p)} · {p.clipCount} clip{p.clipCount === 1 ? '' : 's'}</span>
        </span>
      </button>
      <div className="pr-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={startRename} disabled={busy}>Rename</button>
        <button onClick={duplicate} disabled={busy}>Duplicate</button>
        <button className="danger" onClick={remove} disabled={busy || !canDelete}>Delete</button>
      </div>
    </div>
  );
}

interface CardProps {
  p: ProjectSummary;
  current: boolean;
  busy: boolean;
  onOpen: () => void;
  canDelete: boolean;
}

// Shared rename / duplicate / delete wiring for a card or row.
function useProjectActions(p: ProjectSummary, canDelete: boolean) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(p.name);

  const startRename = () => { setDraft(p.name); setRenaming(true); };
  const cancelRename = () => setRenaming(false);
  const commitRename = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== p.name) api.renameProject(p.id, name).catch(() => {});
  };
  const duplicate = () => api.duplicateProject(p.id).catch(() => {});
  const remove = () => {
    if (!canDelete) return;
    if (!window.confirm(`Delete “${p.name}”? This can't be undone.`)) return;
    api.deleteProject(p.id).catch(() => {});
  };
  return { renaming, draft, setDraft, startRename, commitRename, cancelRename, duplicate, remove };
}

// ---- new project dialog ----
function NewProjectDialog({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (w: number, h: number, name: string) => void }) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(PRESETS[0].key);
  const ref = useRef<HTMLInputElement>(null);
  const chosen = PRESETS.find((p) => p.key === preset) ?? PRESETS[0];

  return (
    <>
      <div className="dlg-backdrop" onClick={onClose} />
      <div className="dlg" role="dialog" aria-label="New project">
        <div className="dlg-head">
          <h2>New project</h2>
          <button className="dlg-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <label className="dlg-field">
          <span>Name</span>
          <input ref={ref} value={name} autoFocus placeholder="Untitled" maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onCreate(chosen.w, chosen.h, name); }} />
        </label>
        <span className="dlg-label">Aspect ratio</span>
        <div className="dlg-presets">
          {PRESETS.map((p) => (
            <button key={p.key} className={`preset${preset === p.key ? ' on' : ''}`} onClick={() => setPreset(p.key)}>
              <span className="preset-frame" style={frameStyle(p.w, p.h)} />
              <span className="preset-label">{p.label}</span>
              <span className="preset-sub">{p.sub}</span>
            </button>
          ))}
        </div>
        <div className="dlg-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => onCreate(chosen.w, chosen.h, name)}>Create project</button>
        </div>
      </div>
    </>
  );
}

// ---- content poster ----
// The server sends a representative poster moment for each project. Rebuild the
// same layer payload the preview uses, then paint it with lightweight DOM/CSS so
// filters and clip content show up in the project launcher.
function Poster({ p }: { p: ProjectSummary }) {
  const ar = p.width && p.height ? p.width / p.height : 16 / 9;
  const layers = useMemo(() => {
    const poster = p.poster;
    if (!poster) return [];
    return buildLayers(poster.clips, poster.tracks, poster.assets, poster.playhead, p.width, p.height);
  }, [p]);
  return (
    <span className="poster">
      <span className={`poster-stage${layers.length ? '' : ' empty'}`} style={{ aspectRatio: `${ar}` }}>
        {layers.map((layer) => <PosterLayer key={layer.id} layer={layer} />)}
      </span>
    </span>
  );
}

function PosterLayer({ layer }: { layer: Layer }) {
  const style = posterLayerStyle(layer);
  if (layer.kind === 'image' && layer.url) {
    return (
      <span className="poster-layer" style={style}>
        <img className="poster-media" src={layer.url} alt="" draggable={false} />
      </span>
    );
  }
  if (layer.kind === 'video' && layer.url) {
    return (
      <span className="poster-layer" style={style}>
        <PosterVideo layer={layer} />
      </span>
    );
  }
  if (layer.kind === 'text') {
    return (
      <span className="poster-layer" style={style}>
        <span className="poster-text" style={posterTextStyle(layer)}>{layer.text}</span>
      </span>
    );
  }
  return <span className="poster-layer poster-procedural" style={{ ...style, background: proceduralBackground(layer) }} />;
}

function PosterVideo({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : layer.time;
      const maxTime = Math.max(0, duration - 0.05);
      const target = Math.max(0, Math.min(layer.time, maxTime));
      if (Math.abs(video.currentTime - target) > 0.04) video.currentTime = target;
      video.pause();
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek);
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [layer.time, layer.url]);

  return <video ref={ref} className="poster-media" src={layer.url ?? undefined} muted playsInline preload="metadata" />;
}

function posterLayerStyle(layer: Layer): CSSProperties {
  const width = Math.max(1, layer.scale * layer.aspectX * 100);
  const height = Math.max(1, layer.scale * layer.aspectY * 100);
  return {
    left: `${50 + layer.x * 50}%`,
    top: `${50 - layer.y * 50}%`,
    width: `${width}%`,
    height: `${height}%`,
    opacity: Math.max(0, Math.min(1, layer.opacity)),
    transform: `translate(-50%, -50%) rotate(${layer.rotation ?? 0}deg)`,
    filter: posterGrade(layer),
  };
}

function posterTextStyle(layer: Layer): CSSProperties {
  const projectHeight = Math.max(1, layer.projH ?? 720);
  const size = Math.max(8, Math.min(32, ((layer.fontSize ?? 64) / projectHeight) * 180));
  return {
    color: layer.fontColor ?? '#ffffff',
    fontFamily: fontStack(layer.fontFamily),
    fontSize: `${size}px`,
    fontWeight: layer.fontWeight ?? 700,
    textAlign: (layer.align ?? 'center') as CSSProperties['textAlign'],
  };
}

function proceduralBackground(layer: Layer): string {
  const hue = Math.round((((layer.hue % 1) + 1) % 1) * 360);
  return `hsl(${hue} 45% 35%)`;
}

function posterGrade(layer: Layer): string {
  const parts = [
    `brightness(${layer.brightness.toFixed(3)})`,
    `saturate(${layer.saturation.toFixed(3)})`,
    `contrast(${layer.contrast.toFixed(3)})`,
  ];
  if (layer.temperature > 0.001) parts.push(`sepia(${Math.min(0.7, layer.temperature * 0.7).toFixed(3)})`);
  else if (layer.temperature < -0.001) parts.push(`hue-rotate(${(layer.temperature * 22).toFixed(1)}deg)`);
  return parts.join(' ');
}

// ---- helpers ----
function aspectLabel(p: ProjectSummary): string {
  if (!p.width || !p.height) return '16:9';
  const g = gcd(p.width, p.height);
  return `${p.width / g}:${p.height / g}`;
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }

function frameStyle(w: number, h: number): CSSProperties {
  // fit the aspect into a 30×22 box so the preset chip shows the real shape
  const ar = w / h;
  const bw = 30, bh = 22;
  const fw = ar >= bw / bh ? bw : bh * ar;
  const fh = ar >= bw / bh ? bw / ar : bh;
  return { width: `${fw}px`, height: `${fh}px` };
}

function relTime(iso?: string): string {
  if (!iso) return 'Edited recently';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Edited recently';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 45) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- glyphs ----
function GridGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>
  );
}
function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
  );
}
function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  );
}
function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
  );
}
