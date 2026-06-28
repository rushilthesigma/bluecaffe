import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { exportMp4, type ExportProgress } from '../exportEngine';

type Phase = 'idle' | 'rendering' | 'audio' | 'encoding' | 'muxing' | 'done';

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function findCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas.preview-canvas');
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const contentEnd = useStore((s) => s.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase === 'rendering' || phase === 'audio' || phase === 'encoding' || phase === 'muxing';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const startExport = async () => {
    if (contentEnd <= 0) { setNote('Add a clip to the timeline first.'); return; }
    setNote(null);
    setPhase('rendering');
    setProgress({ phase: 'rendering', pct: 0, frame: 0, totalFrames: 0 });
    abortRef.current = new AbortController();

    try {
      const blob = await exportMp4(
        project,
        clips,
        assets,
        project.tracks,
        (p) => {
          setProgress(p);
          setPhase(p.phase as Phase);
        },
        abortRef.current.signal,
      );
      const url = URL.createObjectURL(blob);
      download(url, `${safeName(project.name)}.mp4`);
      setPhase('done');
      setNote('Exported as MP4.');
    } catch (err: unknown) {
      setPhase('idle');
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'Export cancelled') setNote(`Export failed: ${msg}`);
    }
  };

  const cancelExport = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setProgress(null);
  };

  const snapshot = () => {
    const canvas = findCanvas();
    if (!canvas) { setNote('Preview canvas not ready.'); return; }
    try {
      download(canvas.toDataURL('image/png'), `${safeName(project.name)}-frame.png`);
      setNote('Saved current frame as PNG.');
    } catch {
      setNote('Could not read the canvas (play once first, then snapshot).');
    }
  };

  const pct = progress ? Math.round(progress.pct * 100) : 0;

  const phaseLabel = (() => {
    if (!progress) return 'Starting…';
    switch (progress.phase) {
      case 'rendering': return `Rendering frame ${progress.frame ?? 0} of ${progress.totalFrames ?? 0}…`;
      case 'audio':     return 'Mixing audio…';
      case 'encoding':  return 'Encoding audio…';
      case 'muxing':    return 'Finalising MP4…';
      default:          return '';
    }
  })();

  return (
    <>
      <div className="menu-backdrop" onClick={() => !busy && onClose()} />
      <div className="export-dialog" role="dialog" aria-label="Export">
        <div className="export-head">
          <span className="export-title">Export</span>
          <button className="icon-btn" onClick={() => !busy && onClose()} disabled={busy} title="Close">✕</button>
        </div>

        <div className="export-meta">
          <span>{project.width}×{project.height}</span>
          <span>·</span>
          <span>{project.fps} fps</span>
          <span>·</span>
          <span>{contentEnd.toFixed(1)}s</span>
        </div>

        {busy && (
          <div className="export-progress">
            <div className="export-bar"><div className="export-fill" style={{ width: `${pct}%` }} /></div>
            <div className="export-prog-row">
              <span>{phaseLabel}</span>
              <button className="btn danger sm" onClick={cancelExport}>Cancel</button>
            </div>
          </div>
        )}

        {!busy && (
          <div className="export-actions">
            <button className="export-card" onClick={startExport}>
              <span className="export-card-ico">▶</span>
              <span className="export-card-body">
                <span className="export-card-title">Export video</span>
                <span className="export-card-sub">Render all frames and export as MP4 with audio</span>
              </span>
            </button>
            <button className="export-card" onClick={snapshot}>
              <span className="export-card-ico">▣</span>
              <span className="export-card-body">
                <span className="export-card-title">Snapshot</span>
                <span className="export-card-sub">Save the current frame as PNG</span>
              </span>
            </button>
          </div>
        )}

        {note && <p className="export-note">{note}</p>}
      </div>
    </>
  );
}

function safeName(name: string): string {
  return (name || 'deckstop').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'deckstop';
}
