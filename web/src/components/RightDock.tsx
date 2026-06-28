import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { AudioPanel, EffectsPanel, Inspector, TextPanel } from './Inspector';

export function RightDock() {
  const selectedId = useStore((s) => s.selectedClipId);
  const editPulse = useStore((s) => s.editPulse);
  const isAudioSel = useStore((s) => {
    const c = s.clips.find((x) => x.id === s.selectedClipId);
    return !!c && (c.audioOnly || s.assets.find((a) => a.id === c.assetId)?.kind === 'audio');
  });
  const isTextSel = useStore((s) => {
    const c = s.clips.find((x) => x.id === s.selectedClipId);
    return !!c && s.assets.find((a) => a.id === c.assetId)?.kind === 'text';
  });
  const hasFx = useStore((s) => {
    const c = s.clips.find((x) => x.id === s.selectedClipId);
    return !!c && ((c.blur ?? 0) > 0 || (c.vignette ?? 0) > 0 || (c.grain ?? 0) > 0 || (c.pixelate ?? 0) > 0);
  });
  const [tab, setTab] = useState<'inspector' | 'audio' | 'text' | 'fx'>('inspector');
  const dockRef = useRef<HTMLElement>(null);

  // surface the window that matches the selection's type: a title jumps to its
  // Text window, any other clip jumps back to the Inspector. Manual tab clicks
  // aren't overridden (the deps only change when the selected clip changes).
  // Transitions live in the Media panel now, not here.
  useEffect(() => {
    if (isAudioSel) setTab('audio');
    else if (isTextSel) setTab('text');
    else if (selectedId) setTab('inspector');
  }, [selectedId, isAudioSel, isTextSel]);

  // a clip was double-clicked — flash the dock and scroll it into view so it's
  // obvious this is where you remove / edit / add. Skip the very first render.
  const firstPulse = useRef(true);
  useEffect(() => {
    if (firstPulse.current) { firstPulse.current = false; return; }
    const el = dockRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.classList.remove('flash');
    // force a reflow so the animation restarts on a repeat double-click
    void el.offsetWidth;
    el.classList.add('flash');
    const t = window.setTimeout(() => el.classList.remove('flash'), 800);
    return () => window.clearTimeout(t);
  }, [editPulse]);

  return (
    <aside className="panel rightdock" ref={dockRef}>
      <div className="dock-tabs">
        <button
          className={`dock-tab ${tab === 'inspector' ? 'on' : ''}`}
          onClick={() => setTab('inspector')}
        >Inspector</button>
        <button
          className={`dock-tab ${tab === 'audio' ? 'on' : ''}`}
          onClick={() => setTab('audio')}
        >Audio{isAudioSel && <span className="dock-dot audio" aria-hidden />}</button>
        <button
          className={`dock-tab ${tab === 'text' ? 'on' : ''}`}
          onClick={() => setTab('text')}
        >Text{isTextSel && <span className="dock-dot" aria-hidden />}</button>
        <button
          className={`dock-tab ${tab === 'fx' ? 'on' : ''}`}
          onClick={() => setTab('fx')}
        >FX{hasFx && <span className="dock-dot fx" aria-hidden />}</button>
      </div>
      <div className="dock-body">
        {tab === 'inspector' ? <Inspector /> :
         tab === 'audio'     ? <AudioPanel /> :
         tab === 'text'      ? <TextPanel /> :
                               <EffectsPanel />}
      </div>
    </aside>
  );
}
