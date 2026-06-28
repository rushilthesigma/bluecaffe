import { useEffect } from 'react';
import { useStore } from '../state/store';
import { Library } from './Library';
import { Preview } from './Preview';
import { RightDock } from './RightDock';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';
import type { AppState } from '../types';

// Procedural demo project — used when no server is running. Procedural clips
// render as colour-graded swatches so nothing needs uploading.
const DEMO: AppState = {
  rev: 1,
  currentProjectId: 'demo',
  project: {
    id: 'demo',
    name: 'Demo Project',
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [
      { id: 't-v2', name: 'V2', index: 0, kind: 'video' },
      { id: 't-v1', name: 'V1', index: 1, kind: 'video' },
      { id: 't-a1', name: 'A1', index: 2, kind: 'audio' },
    ],
  },
  assets: [
    { id: 'a-p1', name: 'Sunrise', kind: 'procedural', hue: 220, color: '#4d7cff', duration: 8 },
    { id: 'a-p2', name: 'Equalizer', kind: 'procedural', hue: 160, color: '#46b88a', duration: 10 },
    { id: 'a-title', name: 'BlueCaffe', kind: 'text', color: '#a78bfa', duration: 600, text: 'BlueCaffe' },
    { id: 'a-aud', name: 'Music', kind: 'audio', color: '#46b88a', duration: 18 },
  ],
  clips: [
    {
      id: 'c-title',
      trackId: 't-v2',
      assetId: 'a-title',
      name: 'BlueCaffe',
      start: 2.6,
      duration: 4.2,
      inPoint: 0,
      sourceDuration: 600,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      fadeIn: 0.6,
      fadeOut: 0.6,
      loop: false,
      hue: 0,
      brightness: 1,
      saturation: 1,
      contrast: 1,
      temperature: 0,
      filter: 'none',
      color: '#a78bfa',
      text: 'BlueCaffe',
      fontSize: 96,
      fontColor: '#ffffff',
      align: 'center',
      fontWeight: 600,
    },
    {
      id: 'c-vid1',
      trackId: 't-v1',
      assetId: 'a-p1',
      name: 'Sunrise',
      start: 0,
      duration: 8,
      inPoint: 0,
      sourceDuration: 8,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
      hue: 0,
      brightness: 1,
      saturation: 1,
      contrast: 1,
      temperature: 0,
      filter: 'none',
      color: '#4d7cff',
    },
    {
      id: 'c-vid2',
      trackId: 't-v1',
      assetId: 'a-p2',
      name: 'Equalizer',
      start: 8,
      duration: 10,
      inPoint: 0,
      sourceDuration: 10,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
      hue: 0,
      brightness: 1,
      saturation: 1,
      contrast: 1,
      temperature: 0,
      filter: 'none',
      color: '#46b88a',
    },
    {
      id: 'c-aud',
      trackId: 't-a1',
      assetId: 'a-aud',
      name: 'Music',
      start: 0,
      duration: 18,
      inPoint: 0,
      sourceDuration: 18,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
      hue: 0,
      brightness: 1,
      saturation: 1,
      contrast: 1,
      temperature: 0,
      filter: 'none',
      color: '#46b88a',
      audioOnly: true,
    },
  ],
  agents: [],
  tasks: [],
  projects: [
    {
      id: 'demo',
      name: 'Demo Project',
      fps: 30,
      width: 1920,
      height: 1080,
      clipCount: 4,
      trackCount: 3,
    },
  ],
};

export function LandingDemo() {
  useEffect(() => {
    // If the server hasn't provided project data yet, load the procedural demo
    // so the embedded editor has something to show right away.
    const timer = setTimeout(() => {
      if (useStore.getState().rev === 0) {
        useStore.getState().applyServer(DEMO);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="lp-editor-shell">
      <TopBar />
      <div className="workspace">
        <Library />
        <Preview />
        <RightDock />
      </div>
      <Timeline />
    </div>
  );
}
