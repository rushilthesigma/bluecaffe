import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { duplicateClip as cloneClip, splitClip as cutClip, splitAudioAndVideo as detachAudio } from '../clipActions';
import { keyframeTimes } from '../keyframes';
import { ALL_TRANSITIONS, DEFAULT_TRANS_DUR, TransIcon, transLabel, TRANS_DND_TYPE } from '../transitions';
import type { Clip, EaseKind, TransitionKind } from '../types';

const SNAP_PX = 8;
const MIN_DUR = 0.2;
const SEAM_EPS_SEC = 0.05;
const SEAM_OVERLAP_PX = 1;

type TransSide = 'in' | 'out';

interface TransMenuState {
  x: number;
  y: number;
  clipId: string;
  side: TransSide;
}

type DragMode = 'move' | 'trim-l' | 'trim-r';
interface DragState {
  mode: DragMode;
  clipId: string;
  startX: number;
  startY: number;
  moved: boolean;
  orig: Clip;
}

interface MenuState {
  x: number;
  y: number;
  clip: Clip;
}

export function Timeline() {
  const project = useStore((s) => s.project);
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const pxPerSec = useStore((s) => s.pxPerSec);
  const setZoom = useStore((s) => s.setZoom);
  const selectedId = useStore((s) => s.selectedClipId);
  const select = useStore((s) => s.select);
  const focusEditor = useStore((s) => s.focusEditor);
  const playhead = useStore((s) => s.playhead);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const duration = useStore((s) => s.timelineDuration());

  const lanesRef = useRef<HTMLDivElement>(null);
  const lanesScrollRef = useRef<HTMLDivElement>(null);
  const headersInnerRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const drag = useRef<DragState | null>(null);

  // Keep the left track-header gutter vertically aligned with the lanes.
  // The lanes own the scroll; we translate the header rows to match its
  // scrollTop so the two columns line up exactly (the lanes lose height to
  // their horizontal scrollbar, so a second native scroller would drift).
  const onLanesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headersInnerRef.current) {
      headersInnerRef.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
    }
  };
  // Let the wheel scroll the tracks even when the cursor is over the gutter.
  const onHeadersWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (lanesScrollRef.current) lanesScrollRef.current.scrollTop += e.deltaY;
  };

  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [transMenu, setTransMenu] = useState<TransMenuState | null>(null);
  const [junction, setJunction] = useState<{ x: number; y: number; leftId: string; rightId: string } | null>(null);

  const xToSec = (clientX: number) => {
    const rect = lanesRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pxPerSec);
  };

  // snap a value to nearby clip edges / playhead / origin; reports the hit point
  const snapWith = (value: number, ignoreId: string) => {
    const thresh = SNAP_PX / pxPerSec;
    const points = [0, playhead];
    for (const c of clips) {
      if (c.id === ignoreId) continue;
      points.push(c.start, c.start + c.duration);
    }
    let best = value;
    let bestD = thresh;
    let hit: number | null = null;
    for (const p of points) {
      const d = Math.abs(p - value);
      if (d < bestD) {
        bestD = d;
        best = p;
        hit = p;
      }
    }
    return { value: best, hit };
  };
  const snap = (value: number, ignoreId: string) => snapWith(value, ignoreId).value;

  // snap the playhead to clip edges / origin while scrubbing
  const snapTime = (value: number) => {
    const thresh = SNAP_PX / pxPerSec;
    let best = value;
    let bestD = thresh;
    for (const c of clips) {
      for (const p of [c.start, c.start + c.duration]) {
        const d = Math.abs(p - value);
        if (d < bestD) { bestD = d; best = p; }
      }
    }
    const d0 = Math.abs(value);
    if (d0 < bestD) best = 0;
    return best;
  };

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    e.stopPropagation();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    select(clip.id);
    useStore.getState().setSuspendRemote(true);
    drag.current = { mode, clipId: clip.id, startX: e.clientX, startY: e.clientY, moved: false, orig: { ...clip } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) d.moved = true;
    const dSec = (e.clientX - d.startX) / pxPerSec;
    const o = d.orig;
    const patch: Partial<Clip> = {};
    let guide: number | null = null;

    if (d.mode === 'move') {
      let start = Math.max(0, o.start + dSec);
      const sStart = snapWith(start, o.id);
      const sEnd = snapWith(start + o.duration, o.id);
      // prefer whichever edge snaps closer
      const dStart = sStart.hit !== null ? Math.abs(sStart.value - start) : Infinity;
      const dEnd = sEnd.hit !== null ? Math.abs(sEnd.value - (start + o.duration)) : Infinity;
      if (dEnd < dStart) {
        start = sEnd.value - o.duration;
        guide = sEnd.hit;
      } else if (dStart < Infinity) {
        start = sStart.value;
        guide = sStart.hit;
      }
      patch.start = Math.max(0, start);
      // vertical track change
      const target = laneAt(e.clientY);
      if (target && target !== o.trackId) patch.trackId = target;
    } else if (d.mode === 'trim-l') {
      const s = snapWith(o.start + dSec, o.id);
      let delta = s.value - o.start;
      // clamp by source in-point and minimum duration
      delta = Math.max(delta, -o.inPoint);
      delta = Math.max(delta, -o.start);
      delta = Math.min(delta, o.duration - MIN_DUR);
      patch.start = o.start + delta;
      patch.inPoint = o.inPoint + delta;
      patch.duration = o.duration - delta;
      guide = s.hit;
    } else {
      const s = snapWith(o.start + o.duration + dSec, o.id);
      let dur = s.value - o.start;
      // looping clips can be stretched past their source; otherwise capped to it
      const maxDur = o.loop ? 3600 : o.sourceDuration - o.inPoint;
      dur = Math.max(MIN_DUR, Math.min(dur, maxDur));
      patch.duration = dur;
      guide = s.hit;
    }
    setSnapGuide(guide);
    useStore.getState().patchClipLocal(d.clipId, patch);
  };

  const laneAt = (clientY: number): string | null => {
    for (const t of project.tracks) {
      const el = laneRefs.current[t.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return t.id;
    }
    return null;
  };

  const revealClipInPreview = (clip: Clip) => {
    const st = useStore.getState();
    const kind = st.assets.find((a) => a.id === clip.assetId)?.kind;
    if (kind === 'audio') return;
    if (st.playhead >= clip.start && st.playhead < clip.start + clip.duration) return;
    st.setPlayhead(clip.start + Math.min(0.1, Math.max(0, clip.duration / 2)));
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    setSnapGuide(null);
    if (!d) return;
    const clip = useStore.getState().clips.find((c) => c.id === d.clipId);
    if (clip) {
      if (d.mode === 'move' && !d.moved) revealClipInPreview(clip);
      await api.patchClip(clip.id, {
        start: clip.start,
        duration: clip.duration,
        inPoint: clip.inPoint,
        trackId: clip.trackId,
      });
    }
    setTimeout(() => useStore.getState().setSuspendRemote(false), 60);
  };

  // drag from media bin
  const onLaneDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('application/x-deckstop-asset');
    if (!assetId) return;
    const asset = assets.find((a) => a.id === assetId);
    const start = snap(xToSec(e.clientX), '');
    await api.addClip({
      assetId,
      trackId,
      start,
      duration: asset && (asset.kind === 'video' || asset.kind === 'audio')
        ? asset.duration
        : Math.min(asset?.duration ?? 4, 4),
    });
  };

  // playhead scrub — used by both the ruler and the playhead handle
  const startScrub = (e: React.PointerEvent) => {
    e.stopPropagation();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    setScrubbing(true);
    setPlayhead(snapTime(xToSec(e.clientX)));
    const move = (ev: PointerEvent) => setPlayhead(snapTime(xToSec(ev.clientX)));
    const up = () => {
      setScrubbing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- context-menu actions ----
  const openMenu = (e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    select(clip.id);
    setMenu({ x: e.clientX, y: e.clientY, clip });
  };

  // duplicate / split share their implementation with the Inspector's quick
  // actions (clipActions.ts) so both surfaces behave identically; the timeline
  // just feeds in a snapped drop position for the copy.
  const duplicateClip = (clip: Clip) => cloneClip(clip, snap(clip.start + clip.duration, ''));
  const splitClip = (clip: Clip, at: number) => cutClip(clip, at);
  const splitAudioAndVideo = (clip: Clip) => detachAudio(clip);

  // ---- transitions (dropped from the Media panel onto a clip) ----
  // Filmora model: drop on a clip's start = entry transition, on its end = exit.
  // Keep an already-tuned length on that side; otherwise use the default.
  const applyTransition = (clip: Clip, side: TransSide, kind: TransitionKind) => {
    const had = side === 'in' ? clip.transIn : clip.transOut;
    const curDur = side === 'in' ? clip.transInDur : clip.transOutDur;
    const dur = had && had !== 'none' && curDur
      ? curDur
      : Math.min(DEFAULT_TRANS_DUR, Math.max(0.2, clip.duration / 2));
    const patch: Partial<Clip> = side === 'in'
      ? { transIn: kind, transInDur: dur }
      : { transOut: kind, transOutDur: dur };
    useStore.getState().patchClipLocal(clip.id, patch);
    select(clip.id);
    api.patchClip(clip.id, patch);
  };

  const openTransMenu = (e: React.MouseEvent, clip: Clip, side: TransSide) => {
    e.stopPropagation();
    select(clip.id);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTransMenu({ x: r.left, y: r.top, clipId: clip.id, side });
  };

  // ---- junctions (a transition placed BETWEEN two touching clips) ----
  // Sets the left clip's exit and the right clip's entry to the same kind +
  // length. A dissolve then cross-blends the two across the cut; a fade dips to
  // black between them. Pushes hand off one direction into the next.
  const applyJunction = (leftId: string, rightId: string, kind: TransitionKind) => {
    const st = useStore.getState();
    const L = st.clips.find((c) => c.id === leftId);
    const R = st.clips.find((c) => c.id === rightId);
    if (!L || !R) return;
    const remove = kind === 'none';
    const dur = Math.max(0.2, Math.min(DEFAULT_TRANS_DUR, L.duration / 2, R.duration / 2));
    const joinedStart = L.start + L.duration;
    const closeGap = Math.abs(R.start - joinedStart) <= SEAM_EPS_SEC;
    const lp: Partial<Clip> = remove ? { transOut: 'none' } : { transOut: kind, transOutDur: dur };
    const rp: Partial<Clip> = {
      ...(remove ? { transIn: 'none' } : { transIn: kind, transInDur: dur }),
      ...(closeGap ? { start: joinedStart } : {}),
    };
    st.patchClipLocal(leftId, lp);
    st.patchClipLocal(rightId, rp);
    api.patchClip(leftId, lp).catch(() => {});
    api.patchClip(rightId, rp).catch(() => {});
  };

  // close the context menu on any outside interaction
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  // close the transition popover on outside interaction (its own pointerdown is
  // stopped, so an outside click here dismisses it)
  useEffect(() => {
    if (!transMenu) return;
    const close = () => setTransMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTransMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [transMenu]);

  // close the junction menu on outside interaction
  useEffect(() => {
    if (!junction) return;
    const close = () => setJunction(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setJunction(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [junction]);

  // delete selected clip / split / duplicate / play-pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const st = useStore.getState();
      const sel = st.clips.find((c) => c.id === st.selectedClipId);
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        api.deleteClip(sel.id);
        select(null);
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D') && sel) {
        e.preventDefault();
        duplicateClip(sel);
      } else if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && sel) {
        e.preventDefault();
        splitClip(sel, st.playhead);
      } else if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && sel) {
        e.preventDefault();
        api.patchClip(sel.id, { loop: !sel.loop });
      } else if (e.key === ' ') {
        e.preventDefault();
        st.setPlaying(!st.playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  const ticks = buildTicks(duration, pxPerSec);
  const width = duration * pxPerSec;
  const kindOf = new Map(assets.map((a) => [a.id, a.kind]));
  const joinedEdges = useMemo(() => {
    const edges = new Map<string, { left: boolean; right: boolean }>();
    const mark = (id: string, side: 'left' | 'right') => {
      const cur = edges.get(id) ?? { left: false, right: false };
      cur[side] = true;
      edges.set(id, cur);
    };
    const visualEps = SEAM_OVERLAP_PX / Math.max(1, pxPerSec);
    for (const t of project.tracks) {
      const lane = clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
      for (let i = 0; i < lane.length - 1; i++) {
        const a = lane[i], b = lane[i + 1];
        const gap = b.start - (a.start + a.duration);
        if (Math.abs(gap) <= visualEps) {
          mark(a.id, 'right');
          mark(b.id, 'left');
        }
      }
    }
    return edges;
  }, [clips, project.tracks, pxPerSec]);

  // seams between touching clips on a track — the place a "between two pieces"
  // transition lives. A junction is "set" when both sides carry the same kind.
  const seamsFor = (trackId: string) => {
    const lane = clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
    const out: { leftId: string; rightId: string; x: number; kind: TransitionKind }[] = [];
    for (let i = 0; i < lane.length - 1; i++) {
      const a = lane[i], b = lane[i + 1];
      if (Math.abs(a.start + a.duration - b.start) > SEAM_EPS_SEC) continue; // not touching
      const lk = a.transOut && a.transOut !== 'none' ? a.transOut : null;
      const rk = b.transIn && b.transIn !== 'none' ? b.transIn : null;
      const kind: TransitionKind = lk && rk && lk === rk ? lk : 'none';
      out.push({ leftId: a.id, rightId: b.id, x: (a.start + a.duration) * pxPerSec, kind });
    }
    return out;
  };

  // toolbar acts on the current selection (mirrors the right-click menu + keys)
  const sel = clips.find((c) => c.id === selectedId) ?? null;
  const canSplit = !!sel && playhead > sel.start + MIN_DUR && playhead < sel.start + sel.duration - MIN_DUR;
  const removeSel = () => { if (sel) { api.deleteClip(sel.id); select(null); } };
  const fitZoom = () => {
    const w = lanesScrollRef.current?.clientWidth ?? 800;
    if (duration > 0) setZoom(Math.floor((w - 24) / duration));
  };

  return (
    <section className="panel timeline">
      <div className="timeline-toolbar">
        <div className="tl-tools">
          <button className="tl-tool" disabled={!canSplit} onClick={() => sel && splitClip(sel, playhead)} title="Split at playhead (S)">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="14" r="2.2" />
              <path d="M7 7l10 7M7 13l10-7" />
            </svg>
          </button>
          <button className="tl-tool" disabled={!sel} onClick={() => sel && duplicateClip(sel)} title="Duplicate (⌘D)">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="7" width="9" height="9" rx="1.6" /><path d="M4 13V4h9" />
            </svg>
          </button>
          <button className="tl-tool danger" disabled={!sel} onClick={removeSel} title="Delete (Del)">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
            </svg>
          </button>
          <span className="tl-sep" />
          <button className="tl-tool wide" onClick={() => api.addTrack()} title="Add a track">＋ Track</button>
        </div>
        <div className="spacer" />
        <span className="tl-hint">Drag to move · grab an edge to trim · right-click for more</span>
        <div className="zoom">
          <button className="tl-tool" onClick={() => setZoom(pxPerSec - 16)} title="Zoom out">−</button>
          <input
            type="range" className="zoom-slider" min={16} max={220} value={pxPerSec}
            onChange={(e) => setZoom(Number(e.target.value))} title="Zoom"
          />
          <button className="tl-tool" onClick={() => setZoom(pxPerSec + 16)} title="Zoom in">+</button>
          <button className="tl-tool wide" onClick={fitZoom} title="Zoom to fit">Fit</button>
        </div>
      </div>

      <div className="timeline-body">
        <div className="track-headers" onWheel={onHeadersWheel}>
          <div className="ruler-corner" />
          <div className="track-headers-inner" ref={headersInnerRef}>
            {project.tracks.map((t) => (
              <div className="track-header" key={t.id}>
                <span className="track-name">{t.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lanes-scroll" ref={lanesScrollRef} onScroll={onLanesScroll}>
          <div
            className="lanes"
            ref={lanesRef}
            style={{ width }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={() => select(null)}
          >
            <div className="ruler" onPointerDown={startScrub}>
              {ticks.map((tk) => (
                <div className="tick" key={tk.sec} style={{ left: tk.x }}>
                  <span className="tick-label">{tk.label}</span>
                </div>
              ))}
            </div>

            {project.tracks.map((t) => (
              <div
                key={t.id}
                className="lane"
                ref={(el) => { laneRefs.current[t.id] = el; }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => onLaneDrop(e, t.id)}
              >
                {clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start).map((c) => (
                  <ClipView
                    key={c.id}
                    clip={c}
                    kind={kindOf.get(c.assetId)}
                    pxPerSec={pxPerSec}
                    selected={c.id === selectedId}
                    joinedLeft={joinedEdges.get(c.id)?.left ?? false}
                    joinedRight={joinedEdges.get(c.id)?.right ?? false}
                    onDown={onClipPointerDown}
                    onContext={openMenu}
                    onEdit={focusEditor}
                    onApplyTrans={applyTransition}
                    onTransMenu={openTransMenu}
                  />
                ))}
                {seamsFor(t.id).map((s) => (
                  <button
                    key={`${s.leftId}_${s.rightId}`}
                    type="button"
                    className={`seam${s.kind !== 'none' ? ' on' : ''}`}
                    style={{ left: s.x }}
                    title={s.kind !== 'none' ? `Transition: ${transLabel(s.kind)} — click to change` : 'Add a transition between these clips'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setJunction({ x: r.left + r.width / 2, y: r.top - 8, leftId: s.leftId, rightId: s.rightId });
                    }}
                  >
                    {s.kind !== 'none' ? <TransIcon kind={s.kind} size={12} /> : <span className="seam-plus">+</span>}
                  </button>
                ))}
              </div>
            ))}

            {snapGuide !== null && (
              <div className="snap-guide" style={{ left: snapGuide * pxPerSec }} />
            )}

            <div className={`playhead ${scrubbing ? 'scrubbing' : ''}`} style={{ left: playhead * pxPerSec }}>
              <div className="playhead-head" onPointerDown={startScrub} />
              {scrubbing && <div className="scrub-time">{tcLabel(playhead)}</div>}
            </div>
          </div>
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: 'Split at playhead',
              hint: 'S',
              disabled: !(playhead > menu.clip.start + MIN_DUR && playhead < menu.clip.start + menu.clip.duration - MIN_DUR),
              onClick: () => splitClip(menu.clip, playhead),
            },
            {
              label: menu.clip.muted ? 'Audio already split' : 'Split audio and video',
              disabled: kindOf.get(menu.clip.assetId) !== 'video' || !!menu.clip.muted,
              onClick: () => splitAudioAndVideo(menu.clip),
            },
            { label: 'Duplicate', hint: '⌘D', onClick: () => duplicateClip(menu.clip) },
            {
              label: menu.clip.loop ? '✓ Loop' : 'Loop',
              hint: 'L',
              onClick: () => api.patchClip(menu.clip.id, { loop: !menu.clip.loop }),
            },
            { sep: true },
            { label: 'Delete', hint: 'Del', danger: true, onClick: () => { api.deleteClip(menu.clip.id); select(null); } },
          ]}
          onClose={() => setMenu(null)}
        />
      )}

      {transMenu && (() => {
        const tc = clips.find((c) => c.id === transMenu.clipId);
        return tc ? (
          <TransitionPopover
            x={transMenu.x}
            y={transMenu.y}
            clip={tc}
            side={transMenu.side}
            onClose={() => setTransMenu(null)}
          />
        ) : null;
      })()}

      {junction && (() => {
        const L = clips.find((c) => c.id === junction.leftId);
        const R = clips.find((c) => c.id === junction.rightId);
        const active: TransitionKind = L && R && L.transOut && L.transOut !== 'none' && L.transOut === R.transIn ? L.transOut : 'none';
        return (
          <JunctionMenu
            x={junction.x}
            y={junction.y}
            active={active}
            onPick={(k) => { applyJunction(junction.leftId, junction.rightId, k); setJunction(null); }}
            onClose={() => setJunction(null)}
          />
        );
      })()}
    </section>
  );
}

// The "between two clips" picker, opened from a seam's + button. Choosing a kind
// writes it to both sides of the cut; "None" lifts it. Dissolve cross-blends the
// two clips, Fade dips to black, the pushes hand one off into the next.
function JunctionMenu({ x, y, active, onPick, onClose }: {
  x: number; y: number; active: TransitionKind;
  onPick: (k: TransitionKind) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(active !== 'none' ? 222 : 184);
  const width = 208;

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setHeight(rect.height);
  }, [active]);

  const left = Math.max(8, Math.min(x - width / 2, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y - height, window.innerHeight - height - 8));
  return (
    <div ref={ref} className="junction-pop" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="trans-pop-head">Transition between clips</div>
      <div className="junction-grid">
        {ALL_TRANSITIONS.map((t) => (
          <button
            key={t.kind}
            type="button"
            className={`junction-tile${active === t.kind ? ' on' : ''}`}
            title={t.label}
            onClick={() => onPick(t.kind)}
          >
            <span className="junction-ico"><TransIcon kind={t.kind} size={18} /></span>
            <span className="junction-name">{t.short}</span>
          </button>
        ))}
      </div>
      {active !== 'none' && (
        <button className="trans-pop-remove" type="button" onClick={() => onPick('none')}>Remove transition</button>
      )}
      <button className="junction-close" type="button" onClick={onClose} aria-label="Close">Done</button>
    </div>
  );
}

// Small Filmora-style properties popover for a transition already on a clip:
// change the direction, adjust the length, or remove it. Opened by clicking the
// transition badge on the timeline; closes on any outside click.
const TRANS_EASE_KINDS: EaseKind[] = ['ease-out', 'ease-in', 'linear', 'ease-in-out', 'bounce', 'elastic', 'back'];
const TRANS_EASE_LABELS: Record<string, string> = {
  'ease-out': 'Ease Out', 'ease-in': 'Ease In', 'linear': 'Linear',
  'ease-in-out': 'S-Curve', 'bounce': 'Bounce', 'elastic': 'Spring', 'back': 'Back',
};

function TransEaseCurve({ kind }: { kind: EaseKind }) {
  const paths: Record<string, string> = {
    'ease-in':     'M 0 12 C 1 12 12 3 12 0',
    'ease-out':    'M 0 12 C 0 9 11 0 12 0',
    'ease-in-out': 'M 0 12 C 3 12 9 0 12 0',
    'linear':      'M 0 12 L 12 0',
    'bounce':      'M 0 12 L 6 0 L 7.5 3.5 L 9.5 0.5 L 12 0',
    'elastic':     'M 0 12 C 3 12 2 -3 6 -3 C 9 -3 10 1 12 0',
    'back':        'M 0 12 C 5 12 12 -2 12 0',
  };
  return (
    <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
      <path d={paths[kind] ?? 'M 0 12 L 12 0'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TransitionPopover({ x, y, clip, side, onClose }: {
  x: number; y: number; clip: Clip; side: TransSide; onClose: () => void;
}) {
  const kind = (side === 'in' ? clip.transIn : clip.transOut) ?? 'none';
  const dur = (side === 'in' ? clip.transInDur : clip.transOutDur) ?? DEFAULT_TRANS_DUR;
  const ease = (side === 'in' ? clip.transInEase : clip.transOutEase) ?? (side === 'in' ? 'ease-out' : 'ease-in');
  const saveTimer = useRef<number | null>(null);

  const commit = (patch: Partial<Clip>) => {
    useStore.getState().setSuspendRemote(true);
    useStore.getState().patchClipLocal(clip.id, patch);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const c = useStore.getState().clips.find((x) => x.id === clip.id);
      if (c) await api.patchClip(c.id, {
        transIn: c.transIn, transInDur: c.transInDur, transInEase: c.transInEase,
        transOut: c.transOut, transOutDur: c.transOutDur, transOutEase: c.transOutEase,
      });
      useStore.getState().setSuspendRemote(false);
    }, 180);
  };

  const setKind = (k: TransitionKind) => commit(side === 'in' ? { transIn: k } : { transOut: k });
  const setDur = (d: number) => commit(side === 'in' ? { transInDur: d } : { transOutDur: d });
  const setEase = (e: EaseKind) => commit(side === 'in' ? { transInEase: e } : { transOutEase: e });
  const remove = () => { commit(side === 'in' ? { transIn: 'none' } : { transOut: 'none' }); onClose(); };

  const maxDur = Math.max(0.2, Math.min(3, clip.duration));
  const left = Math.min(x, window.innerWidth - 244);
  const bottom = window.innerHeight - y + 4;

  return (
    <div className="trans-pop" style={{ left, bottom }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="trans-pop-head">{side === 'in' ? 'Transition in' : 'Transition out'}</div>
      <div className="trans-pop-dirs">
        {ALL_TRANSITIONS.map((t) => (
          <button
            key={t.kind}
            type="button"
            title={t.label}
            className={`trans-pop-dir${kind === t.kind ? ' on' : ''}`}
            onClick={() => setKind(t.kind)}
          ><TransIcon kind={t.kind} size={15} /></button>
        ))}
      </div>
      <div className="trans-pop-dur">
        <span className="trans-pop-label">Length</span>
        <input
          type="range" min={0.1} max={maxDur} step={0.1} value={Math.min(dur, maxDur)}
          onChange={(e) => setDur(parseFloat(e.target.value))}
        />
        <span className="trans-pop-val">{dur.toFixed(1)}s</span>
      </div>
      <div className="trans-pop-ease">
        <span className="trans-pop-label">Easing</span>
        <div className="trans-pop-ease-btns">
          {TRANS_EASE_KINDS.map((e) => (
            <button key={e} type="button"
              className={`trans-pop-ease-btn${ease === e ? ' on' : ''}`}
              title={TRANS_EASE_LABELS[e]}
              onClick={() => setEase(e)}
            ><TransEaseCurve kind={e} /></button>
          ))}
        </div>
      </div>
      <button className="trans-pop-remove" type="button" onClick={remove}>Remove transition</button>
    </div>
  );
}

function ClipView({
  clip,
  kind,
  pxPerSec,
  selected,
  joinedLeft,
  joinedRight,
  onDown,
  onContext,
  onEdit,
  onApplyTrans,
  onTransMenu,
}: {
  clip: Clip;
  kind?: string;
  pxPerSec: number;
  selected: boolean;
  joinedLeft: boolean;
  joinedRight: boolean;
  onDown: (e: React.PointerEvent, c: Clip, m: DragMode) => void;
  onContext: (e: React.MouseEvent, c: Clip) => void;
  onEdit: (id: string) => void;
  onApplyTrans: (c: Clip, side: TransSide, kind: TransitionKind) => void;
  onTransMenu: (e: React.MouseEvent, c: Clip, side: TransSide) => void;
}) {
  const left = clip.start * pxPerSec;
  const w = clip.duration * pxPerSec;
  const fadeInPct = clip.duration > 0 ? (clip.fadeIn / clip.duration) * 100 : 0;
  const fadeOutPct = clip.duration > 0 ? (clip.fadeOut / clip.duration) * 100 : 0;
  const isAudio = kind === 'audio';
  const isText = kind === 'text';
  const label = isText ? (clip.text?.split('\n')[0] || clip.name) : clip.name;
  // keyframe diamonds along the clip, placed by their local time
  const kfTimes = keyframeTimes(clip);
  const dur = Math.max(0.001, clip.duration);

  // which half a dragged transition would land on (left = entry, right = exit)
  const [dropSide, setDropSide] = useState<TransSide | null>(null);
  const sideAt = (e: React.DragEvent): TransSide => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX - r.left < r.width / 2 ? 'in' : 'out';
  };
  const isTransDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TRANS_DND_TYPE);
  const onTransOver = (e: React.DragEvent) => {
    if (!isTransDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDropSide(sideAt(e));
  };
  const onTransDrop = (e: React.DragEvent) => {
    if (!isTransDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.dataTransfer.getData(TRANS_DND_TYPE) as TransitionKind;
    const side = sideAt(e);
    setDropSide(null);
    if (k) onApplyTrans(clip, side, k);
  };

  const transIn = clip.transIn && clip.transIn !== 'none' ? clip.transIn : null;
  const transOut = clip.transOut && clip.transOut !== 'none' ? clip.transOut : null;
  const transInPct = transIn ? Math.min(100, ((clip.transInDur ?? DEFAULT_TRANS_DUR) / dur) * 100) : 0;
  const transOutPct = transOut ? Math.min(100, ((clip.transOutDur ?? DEFAULT_TRANS_DUR) / dur) * 100) : 0;

  return (
    <div
      className={`clip ${selected ? 'sel' : ''} ${isAudio ? 'audio' : ''} ${isText ? 'text' : ''} ${joinedLeft ? 'joined-left' : ''} ${joinedRight ? 'joined-right' : ''}`}
      style={{ left, width: Math.max(8, w) + (joinedRight ? SEAM_OVERLAP_PX : 0), '--clip': clip.color } as React.CSSProperties}
      onPointerDown={(e) => onDown(e, clip, 'move')}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onEdit(clip.id); }}
      onContextMenu={(e) => onContext(e, clip)}
      onDragOver={onTransOver}
      onDragLeave={() => setDropSide(null)}
      onDrop={onTransDrop}
      title="Double-click to edit"
    >
      <div className="clip-grip l" onPointerDown={(e) => onDown(e, clip, 'trim-l')} />
      <div className="clip-grip r" onPointerDown={(e) => onDown(e, clip, 'trim-r')} />
      {fadeInPct > 0 && <div className="fade in" style={{ width: `${Math.min(100, fadeInPct)}%` }} />}
      {fadeOutPct > 0 && <div className="fade out" style={{ width: `${Math.min(100, fadeOutPct)}%` }} />}
      {dropSide && <div className={`clip-drop ${dropSide}`} />}
      {transIn && (
        <button
          type="button"
          className="clip-trans in"
          style={{ width: `${Math.max(8, transInPct)}%` }}
          title={`Entry: ${transLabel(transIn)} · click to edit`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => onTransMenu(e, clip, 'in')}
        ><TransIcon kind={transIn} size={12} /></button>
      )}
      {transOut && (
        <button
          type="button"
          className="clip-trans out"
          style={{ width: `${Math.max(8, transOutPct)}%` }}
          title={`Exit: ${transLabel(transOut)} · click to edit`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => onTransMenu(e, clip, 'out')}
        ><TransIcon kind={transOut} size={12} /></button>
      )}
      <span className="clip-label">{isAudio ? '♪ ' : ''}{isText ? 'T ' : ''}{label}</span>
      <span className="clip-dur">{clip.duration.toFixed(1)}s</span>
      {clip.loop && <span className="clip-loop" title="Looping">⟳</span>}
      {kfTimes.length > 0 && (
        <div className="clip-kf-row" title={`${kfTimes.length} keyframe${kfTimes.length === 1 ? '' : 's'}`}>
          {kfTimes.map((t, i) => (
            <span
              key={i}
              className="clip-kf"
              style={{ left: `${Math.min(100, (t / dur) * 100)}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MenuItem {
  label?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
  onClick?: () => void;
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  // keep the menu inside the viewport
  const left = Math.min(x, window.innerWidth - 188);
  const top = Math.min(y, window.innerHeight - items.length * 30 - 12);
  return (
    <div className="ctx-menu" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it.sep ? (
          <div className="ctx-sep" key={`sep-${i}`} />
        ) : (
          <div
            key={it.label}
            className={`ctx-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}`}
            onClick={() => {
              if (it.disabled) return;
              it.onClick?.();
              onClose();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span className="ctx-key">{it.hint}</span>}
          </div>
        ),
      )}
    </div>
  );
}

function buildTicks(duration: number, pxPerSec: number) {
  // choose a tick step that keeps labels ~80px apart
  const targetPx = 80;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = steps.find((s) => s * pxPerSec >= targetPx) ?? 60;
  const out: { sec: number; x: number; label: string }[] = [];
  for (let s = 0; s <= duration; s += step) {
    out.push({ sec: s, x: s * pxPerSec, label: fmt(s) });
  }
  return out;
}

function fmt(s: number) {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return mm > 0 ? `${mm}:${ss.toString().padStart(2, '0')}` : `${ss}s`;
}

// precise label for the scrub tooltip
function tcLabel(s: number) {
  const mm = Math.floor(s / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return mm > 0 ? `${mm}:${ss}` : `${ss}s`;
}
