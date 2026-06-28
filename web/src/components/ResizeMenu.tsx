import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import type { Clip } from '../types';

const SCALE_PRESETS = [0.5, 0.75, 1, 1.5, 2];

// A floating, draggable resize panel that edits the clip the user clicked on
// in the preview. Mirrors the Inspector's optimistic-edit + debounced-save
// pattern so changes show instantly and land on the server.
export function ResizeMenu({ clipId, anchorX, anchorY, onClose }: {
  clipId: string;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
}) {
  const clip = useStore((s) => s.clips.find((c) => c.id === clipId) || null);
  const ref = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const [pos, setPos] = useState({ x: anchorX, y: anchorY });

  // a fresh click reposition the panel at the new anchor
  useEffect(() => setPos({ x: anchorX, y: anchorY }), [anchorX, anchorY]);

  // close on Escape; tidy the pending save on unmount
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [onClose]);

  // the targeted clip vanished (deleted elsewhere) — nothing left to resize
  useEffect(() => { if (!clip) onClose(); }, [clip, onClose]);

  const commit = (patch: Partial<Clip>) => {
    useStore.getState().setSuspendRemote(true);
    useStore.getState().patchClipLocal(clipId, patch);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const c = useStore.getState().clips.find((x) => x.id === clipId);
      if (c) await api.patchClip(c.id, { x: c.x, y: c.y, scale: c.scale });
      useStore.getState().setSuspendRemote(false);
    }, 180);
  };

  // drag the panel by its header so it can be moved off whatever it covers
  const onHeadDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const menuEl = ref.current;
    const stage = menuEl?.offsetParent as HTMLElement | null;
    if (!menuEl || !stage) return;
    const sr = stage.getBoundingClientRect();
    const grabX = e.clientX - sr.left - pos.x;
    const grabY = e.clientY - sr.top - pos.y;
    const move = (ev: PointerEvent) => {
      const nx = ev.clientX - sr.left - grabX;
      const ny = ev.clientY - sr.top - grabY;
      setPos({
        x: clamp(nx, 6, Math.max(6, sr.width - menuEl.offsetWidth - 6)),
        y: clamp(ny, 6, Math.max(6, sr.height - menuEl.offsetHeight - 6)),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!clip) return null;

  return (
    <div
      ref={ref}
      className="resize-menu"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="resize-menu-head" onPointerDown={onHeadDown}>
        <span className="resize-menu-title">Resize</span>
        <span className="resize-menu-name" title={clip.name}>{clip.name}</span>
        <button className="resize-menu-close" onClick={onClose} title="Close (Esc)">×</button>
      </div>

      <div className="resize-line">
        <span className="insp-label">Size</span>
        <span className="insp-val">{Math.round(clip.scale * 100)}%</span>
      </div>
      <input
        type="range" min={0.1} max={2} step={0.01} value={clip.scale}
        onChange={(e) => commit({ scale: parseFloat(e.target.value) })}
      />

      <div className="resize-presets">
        {SCALE_PRESETS.map((s) => (
          <button
            key={s}
            type="button"
            className={`resize-chip${Math.abs(clip.scale - s) < 0.005 ? ' on' : ''}`}
            onClick={() => commit({ scale: s })}
          >{Math.round(s * 100)}%</button>
        ))}
      </div>

      <div className="resize-line">
        <span className="insp-label">Position X</span>
        <span className="insp-val">{clip.x.toFixed(2)}</span>
      </div>
      <input type="range" min={-1} max={1} step={0.01} value={clip.x}
        onChange={(e) => commit({ x: parseFloat(e.target.value) })} />

      <div className="resize-line">
        <span className="insp-label">Position Y</span>
        <span className="insp-val">{clip.y.toFixed(2)}</span>
      </div>
      <input type="range" min={-1} max={1} step={0.01} value={clip.y}
        onChange={(e) => commit({ y: parseFloat(e.target.value) })} />

      <button type="button" className="btn sm resize-reset" onClick={() => commit({ scale: 1, x: 0, y: 0 })}>
        Reset transform
      </button>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
