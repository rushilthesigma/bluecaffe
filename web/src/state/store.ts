import { create } from 'zustand';
import type { AppState, Asset, Clip, Task, ProjectSummary } from '../types';

// The server tags any non-video upload as 'image'; reclassify audio by extension
// so the bin, timeline, and audio engine treat .mp3/.wav/etc. as sound.
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)(\?|#|$)/i;
function normAssets(assets: Asset[]): Asset[] {
  return assets.map((a) =>
    a.kind === 'image' && a.url && AUDIO_RE.test(a.url)
      ? { ...a, kind: 'audio' as const, color: a.color === '#94a3b8' ? '#46b88a' : a.color }
      : a,
  );
}

type RightTab = 'inspector' | 'agents';
// Top-level surface. 'landing' is the marketing intro the app opens on; 'home'
// is the project viewer (a Filmora-style launcher); 'editor' is the timeline
// workspace for one project.
type View = 'landing' | 'home' | 'editor';

interface Store extends AppState {
  projects: ProjectSummary[];
  currentProjectId: string;

  // ui
  view: View;
  selectedClipId: string | null;
  playhead: number;
  playing: boolean;
  pxPerSec: number;
  rightTab: RightTab;
  connected: boolean;
  suspendRemote: boolean;
  // bumped whenever a clip is double-clicked, so the editor dock can flash and
  // scroll itself into view — a "you can edit here" cue. The value is a nonce.
  editPulse: number;

  // sync
  connect: () => void;
  applyServer: (s: AppState) => void;

  // ui actions
  setView: (v: View) => void;
  select: (id: string | null) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (px: number) => void;
  setRightTab: (t: RightTab) => void;
  setSuspendRemote: (b: boolean) => void;
  // select a clip and ask the editor dock to surface itself (double-click)
  focusEditor: (id: string) => void;

  // optimistic local edit (during drags)
  patchClipLocal: (id: string, patch: Partial<Clip>) => void;
  upsertClipLocal: (clip: Clip) => void;
  patchTaskLocal: (id: string, patch: Partial<Task>) => void;

  // derived
  timelineDuration: () => number;

  // tutorial
  tutorialStep: number | null;
  startTutorial: () => void;
  advanceTutorial: () => void;
  retreatTutorial: () => void;
  endTutorial: () => void;
}

const EMPTY: AppState = {
  rev: 0,
  project: { id: '', name: 'Loading', fps: 30, width: 1280, height: 720, tracks: [] },
  assets: [],
  clips: [],
  agents: [],
  tasks: [],
  projects: [],
  currentProjectId: '',
};

export const useStore = create<Store>((set, get) => ({
  ...EMPTY,
  projects: [],
  currentProjectId: '',
  view: 'landing',
  selectedClipId: null,
  playhead: 0,
  playing: false,
  pxPerSec: 64,
  rightTab: 'inspector',
  connected: false,
  suspendRemote: false,
  editPulse: 0,
  tutorialStep: null,

  connect: () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => set({ connected: true });
    ws.onclose = () => {
      set({ connected: false });
      setTimeout(() => get().connect(), 1500);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') get().applyServer(msg.state);
      } catch {
        /* ignore */
      }
    };
  },

  applyServer: (s) => {
    const prevPid = get().currentProjectId;
    const pid = s.currentProjectId ?? prevPid;
    const projects = s.projects ?? get().projects;
    // a different project came into focus — the timeline is now a fresh set of
    // clips, so drop the old selection and park the transport at the start
    const switched = !!prevPid && !!pid && prevPid !== pid;
    const onSwitch = switched ? { selectedClipId: null, playhead: 0, playing: false } : {};

    if (get().suspendRemote && !switched) {
      // user is mid-drag; only adopt entities they are not touching
      const sel = get().selectedClipId;
      set({
        rev: s.rev,
        project: s.project,
        assets: normAssets(s.assets),
        agents: s.agents,
        tasks: s.tasks,
        projects,
        currentProjectId: pid,
        clips: s.clips.map((c) => (c.id === sel ? get().clips.find((x) => x.id === c.id) ?? c : c)),
      });
      return;
    }
    set({
      rev: s.rev,
      project: s.project,
      assets: normAssets(s.assets),
      clips: s.clips,
      agents: s.agents,
      tasks: s.tasks,
      projects,
      currentProjectId: pid,
      ...onSwitch,
    });
  },

  setView: (v) => set({ view: v }),
  select: (id) => set({ selectedClipId: id, rightTab: id ? 'inspector' : get().rightTab }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (p) => set({ playing: p }),
  setZoom: (px) => set({ pxPerSec: Math.max(16, Math.min(220, px)) }),
  setRightTab: (t) => set({ rightTab: t }),
  setSuspendRemote: (b) => set({ suspendRemote: b }),
  focusEditor: (id) => set({ selectedClipId: id, rightTab: 'inspector', editPulse: get().editPulse + 1 }),

  patchClipLocal: (id, patch) =>
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
  upsertClipLocal: (clip) => {
    const exists = get().clips.some((c) => c.id === clip.id);
    set({ clips: exists ? get().clips.map((c) => (c.id === clip.id ? clip : c)) : [...get().clips, clip] });
  },
  patchTaskLocal: (id, patch) =>
    set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),

  timelineDuration: () => {
    const clips = get().clips;
    const end = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    return Math.max(20, Math.ceil(end + 6));
  },

  startTutorial: () => set({ tutorialStep: 0 }),
  advanceTutorial: () => {
    const s = get().tutorialStep;
    if (s === null) return;
    set({ tutorialStep: s + 1 });
  },
  retreatTutorial: () => {
    const s = get().tutorialStep;
    if (s === null || s <= 0) return;
    set({ tutorialStep: s - 1 });
  },
  endTutorial: () => set({ tutorialStep: null }),
}));

// debug hook for headless verification
if (typeof window !== 'undefined') (window as unknown as { __ds: typeof useStore }).__ds = useStore;
