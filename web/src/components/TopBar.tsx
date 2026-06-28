import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { ExportDialog } from './ExportDialog';
import { BlueCaffeLogo } from './BlueCaffeLogo';

const RESOLUTION_PRESETS = [
  { key: '1080p', label: '1080p', sub: '16:9 · 1920×1080', w: 1920, h: 1080 },
  { key: '720p', label: '720p', sub: '16:9 · 1280×720', w: 1280, h: 720 },
  { key: 'portrait', label: 'Portrait', sub: '9:16 · 1080×1920', w: 1080, h: 1920 },
  { key: 'square', label: 'Square', sub: '1:1 · 1080×1080', w: 1080, h: 1080 },
  { key: '4k', label: '4K', sub: '16:9 · 3840×2160', w: 3840, h: 2160 },
];

const FPS_PRESETS = [24, 30, 60];

export function TopBar() {
  const project = useStore((s) => s.project);
  const clipCount = useStore((s) => s.clips.length);
  const projectCount = useStore((s) => s.projects.length);
  const setView = useStore((s) => s.setView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);

  return (
    <header className="topbar">
      <button className="brand brand-home" onClick={() => setView('home')} title="Back to all projects">
        <BlueCaffeLogo size={20} />
        <span className="brand-name">BlueCaffe</span>
        <span className="brand-tag">Projects</span>
      </button>
      <div className="topbar-center">
        <button
          className={`proj-switch${menuOpen ? ' open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          title="Switch project"
        >
          <span className="proj-name">{project.name}</span>
          {projectCount > 1 && <span className="proj-count">{projectCount}</span>}
          <span className="proj-caret">▾</span>
        </button>
        <span className="proj-meta">
          {project.width}×{project.height} · {project.fps} fps · {clipCount} clips
        </span>
        {menuOpen && (
          <ProjectMenu
            onClose={() => setMenuOpen(false)}
            onProperties={() => setPropertiesOpen(true)}
          />
        )}
      </div>
      <div className="topbar-right">
        <button className="btn primary export-btn" onClick={() => setExportOpen(true)} title="Export this project">
          <span className="export-up" aria-hidden>⤓</span> Export
        </button>
      </div>
      {propertiesOpen && <ProjectPropertiesDialog onClose={() => setPropertiesOpen(false)} />}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </header>
  );
}

function ProjectMenu({ onClose, onProperties }: { onClose: () => void; onProperties: () => void }) {
  const projects = useStore((s) => s.projects);
  const currentId = useStore((s) => s.currentProjectId);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const current = projects.find((p) => p.id === currentId) ?? null;

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  // close on Escape (unless an inline rename is in progress)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !renaming) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, renaming]);

  const run = async (fn: () => Promise<unknown>, close = true) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (close) onClose();
    } catch {
      setBusy(false);
    }
  };

  const open = (id: string) => {
    if (id === currentId) return onClose();
    run(() => api.openProject(id));
  };

  const create = () => run(() => api.addProject({}));
  const duplicate = () => current && run(() => api.duplicateProject(current.id));

  const remove = () => {
    if (!current || projects.length <= 1) return;
    if (!window.confirm(`Delete project “${current.name}”? This can't be undone.`)) return;
    run(() => api.deleteProject(current.id));
  };

  const startRename = () => {
    if (!current) return;
    setDraft(current.name);
    setRenaming(true);
  };

  const commitRename = () => {
    if (!current) return setRenaming(false);
    const name = draft.trim();
    setRenaming(false);
    if (name && name !== current.name) run(() => api.renameProject(current.id, name), false);
  };

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="proj-menu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="proj-menu-head">
          <span className="proj-menu-title">Projects</span>
          <button className="btn sm" onClick={create} disabled={busy}>＋ New</button>
        </div>

        <div className="proj-list">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`proj-row${p.id === currentId ? ' active' : ''}`}
              onClick={() => open(p.id)}
              disabled={busy}
            >
              <span className="proj-dot" aria-hidden />
              <span className="proj-row-name">{p.name}</span>
              <span className="proj-row-meta">{p.clipCount} clip{p.clipCount === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>

        {current && (
          <>
            <div className="proj-menu-sep" />
            {renaming ? (
              <div className="proj-rename">
                <input
                  ref={renameRef}
                  value={draft}
                  autoFocus
                  maxLength={80}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  onBlur={commitRename}
                />
              </div>
            ) : (
              <div className="proj-menu-actions">
                <button className="proj-action" onClick={startRename} disabled={busy}>Rename</button>
                <button
                  className="proj-action"
                  onClick={() => {
                    onProperties();
                    onClose();
                  }}
                  disabled={busy}
                >
                  Properties
                </button>
                <button className="proj-action" onClick={duplicate} disabled={busy}>Duplicate</button>
                <button
                  className="proj-action danger"
                  onClick={remove}
                  disabled={busy || projects.length <= 1}
                  title={projects.length <= 1 ? 'Keep at least one project' : 'Delete this project'}
                >
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ProjectPropertiesDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [width, setWidth] = useState(String(project.width));
  const [height, setHeight] = useState(String(project.height));
  const [fps, setFps] = useState(String(project.fps));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWidth(String(project.width));
    setHeight(String(project.height));
    setFps(String(project.fps));
  }, [project.id, project.width, project.height, project.fps]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const cleanWidth = clampInt(width, 128, 8192);
  const cleanHeight = clampInt(height, 128, 8192);
  const cleanFps = clampInt(fps, 1, 120);
  const valid = cleanWidth !== null && cleanHeight !== null && cleanFps !== null;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.updateProject(project.id, {
        width: cleanWidth,
        height: cleanHeight,
        fps: cleanFps,
      });
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dlg-backdrop" onClick={() => !busy && onClose()} />
      <form
        className="dlg project-props"
        role="dialog"
        aria-label="Project properties"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="dlg-head">
          <h2>Project properties</h2>
          <button type="button" className="dlg-x" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div className="project-props-summary">
          <span className="project-props-name">{project.name}</span>
          <span>{project.width}×{project.height} · {project.fps} fps</span>
        </div>

        <span className="dlg-label">Resolution</span>
        <div className="dlg-presets project-props-presets">
          {RESOLUTION_PRESETS.map((p) => {
            const active = String(p.w) === width && String(p.h) === height;
            return (
              <button
                key={p.key}
                type="button"
                className={`preset${active ? ' on' : ''}`}
                onClick={() => {
                  setWidth(String(p.w));
                  setHeight(String(p.h));
                }}
              >
                <span className="preset-frame" style={frameStyle(p.w, p.h)} />
                <span className="preset-label">{p.label}</span>
                <span className="preset-sub">{p.sub}</span>
              </button>
            );
          })}
        </div>

        <div className="project-props-grid">
          <label className="dlg-field">
            <span>Width</span>
            <input
              value={width}
              type="number"
              min={128}
              max={8192}
              inputMode="numeric"
              onChange={(e) => setWidth(e.target.value)}
            />
          </label>
          <label className="dlg-field">
            <span>Height</span>
            <input
              value={height}
              type="number"
              min={128}
              max={8192}
              inputMode="numeric"
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
        </div>

        <span className="dlg-label">Frame rate</span>
        <div className="fps-preset-row">
          {FPS_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              className={`fps-chip${fps === String(value) ? ' on' : ''}`}
              onClick={() => setFps(String(value))}
            >
              {value} fps
            </button>
          ))}
        </div>
        <label className="dlg-field">
          <span>Custom FPS</span>
          <input
            value={fps}
            type="number"
            min={1}
            max={120}
            inputMode="numeric"
            onChange={(e) => setFps(e.target.value)}
          />
        </label>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !valid}>Apply</button>
        </div>
      </form>
    </>
  );
}

function clampInt(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function frameStyle(w: number, h: number) {
  const maxW = 30;
  const maxH = 22;
  const scale = Math.min(maxW / w, maxH / h);
  return { width: Math.max(6, w * scale), height: Math.max(6, h * scale) };
}
