import type { Agent, AgentKind, Asset, Clip, Task, Track, AppState, ProjectSummary } from '../types';
import { useStore } from '../state/store';

const LS_KEY = 'bluecaffe-v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function stamp() { return new Date().toISOString(); }

interface LocalProject {
  id: string; name: string; fps: number; width: number; height: number;
  tracks: Track[]; clips: Clip[]; assets: Asset[];
  agents: Agent[]; tasks: Task[];
  createdAt: string; updatedAt: string;
}

interface LocalDB {
  rev: number;
  projects: LocalProject[];
  currentProjectId: string;
}

function load(): LocalDB | null {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}

function save(db: LocalDB) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch { /* quota exceeded */ }
}

function currentProj(db: LocalDB): LocalProject {
  const p = db.projects.find((x) => x.id === db.currentProjectId);
  if (!p) throw new Error('current project not found');
  return p;
}

function blankProject(opts: { name?: string; fps?: number; width?: number; height?: number } = {}): LocalProject {
  const now = stamp();
  return {
    id: uid(), name: opts.name || 'Untitled Project',
    fps: opts.fps || 30, width: opts.width || 1920, height: opts.height || 1080,
    tracks: [
      { id: uid(), name: 'V1', index: 0, kind: 'video' },
      { id: uid(), name: 'A1', index: 1, kind: 'audio' },
    ],
    clips: [], assets: [], agents: [], tasks: [],
    createdAt: now, updatedAt: now,
  };
}

function toSummary(p: LocalProject): ProjectSummary {
  return {
    id: p.id, name: p.name, fps: p.fps, width: p.width, height: p.height,
    clipCount: p.clips.length, trackCount: p.tracks.length,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function toAppState(db: LocalDB): AppState & { projects: ProjectSummary[]; currentProjectId: string } {
  const p = currentProj(db);
  return {
    rev: db.rev,
    project: { id: p.id, name: p.name, fps: p.fps, width: p.width, height: p.height, tracks: p.tracks },
    assets: p.assets, clips: p.clips, agents: p.agents, tasks: p.tasks,
    projects: db.projects.map(toSummary),
    currentProjectId: db.currentProjectId,
  };
}

function commit(fn: (db: LocalDB) => void) {
  const db = load() ?? { rev: 0, projects: [], currentProjectId: '' };
  db.rev = (db.rev || 0) + 1;
  fn(db);
  save(db);
  useStore.getState().applyServer(toAppState(db));
}

const TINY_GAP = 1 / 120;

function rippleTrack(proj: LocalProject, trackId: string) {
  const lane = proj.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  let cursor = 0; let hasPrev = false;
  for (const c of lane) {
    if (hasPrev && c.start - cursor <= TINY_GAP) c.start = cursor;
    cursor = c.start + c.duration;
    hasPrev = true;
  }
}

export function initLocal() {
  let db = load();
  if (!db) {
    const p = blankProject({ name: 'My First Project' });
    db = { rev: 1, projects: [p], currentProjectId: p.id };
    save(db);
  }
  return toAppState(db);
}

export const localEngine = {
  addProject(body: { name?: string; fps?: number; width?: number; height?: number } = {}) {
    let created: LocalProject | null = null;
    commit((db) => { created = blankProject(body); db.projects.push(created); db.currentProjectId = created.id; });
    return { project: toSummary(created!) };
  },

  openProject(id: string) {
    commit((db) => { db.currentProjectId = id; });
    return { ok: true as const };
  },

  duplicateProject(id: string, body: { name?: string } = {}) {
    let created: LocalProject | null = null;
    commit((db) => {
      const src = db.projects.find((p) => p.id === id);
      if (!src) throw new Error('not found');
      const trackMap: Record<string, string> = {};
      const newTracks: Track[] = src.tracks.map((t) => {
        const nid = uid(); trackMap[t.id] = nid; return { ...t, id: nid };
      });
      created = {
        ...src, id: uid(), name: body.name || `${src.name} (copy)`,
        tracks: newTracks,
        clips: src.clips.map((c) => ({ ...c, id: uid(), trackId: trackMap[c.trackId] ?? c.trackId })),
        assets: src.assets.map((a) => ({ ...a, id: uid() })),
        agents: [], tasks: [], createdAt: stamp(), updatedAt: stamp(),
      };
      db.projects.push(created); db.currentProjectId = created.id;
    });
    return { project: toSummary(created!) };
  },

  updateProject(id: string, body: { name?: string; fps?: number; width?: number; height?: number }) {
    let updated: LocalProject | null = null;
    commit((db) => {
      const p = db.projects.find((x) => x.id === id);
      if (!p) throw new Error('not found');
      if (body.name !== undefined) p.name = String(body.name).trim().slice(0, 80) || p.name;
      if (body.fps) p.fps = Number(body.fps);
      if (body.width) p.width = Number(body.width);
      if (body.height) p.height = Number(body.height);
      p.updatedAt = stamp(); updated = p;
    });
    return { project: toSummary(updated!) };
  },

  deleteProject(id: string) {
    commit((db) => {
      if (db.projects.length <= 1) throw new Error('cannot delete the last project');
      db.projects = db.projects.filter((p) => p.id !== id);
      if (db.currentProjectId === id) db.currentProjectId = db.projects[0].id;
    });
    return { ok: true as const };
  },

  addTrack(body: { name?: string; kind?: Track['kind'] } = {}) {
    let created: Track | null = null;
    commit((db) => {
      const proj = currentProj(db);
      const kind = body.kind === 'audio' ? 'audio' as const : 'video' as const;
      if (kind === 'audio') {
        const n = proj.tracks.filter((t) => t.kind === 'audio').length + 1;
        created = { id: uid(), name: body.name || `A${n}`, index: proj.tracks.length, kind };
        proj.tracks.push(created);
      } else {
        for (const t of proj.tracks) t.index += 1;
        created = { id: uid(), name: body.name || `V${proj.tracks.length + 1}`, index: 0, kind };
        proj.tracks.unshift(created);
      }
      proj.updatedAt = stamp();
    });
    return { track: created! };
  },

  addClip(body: { assetId: string; trackId: string; start: number; duration?: number }) {
    let added: Clip | null = null;
    commit((db) => {
      const proj = currentProj(db);
      const asset = proj.assets.find((a) => a.id === body.assetId);
      const track = proj.tracks.find((t) => t.id === body.trackId);
      if (!asset || !track) throw new Error('unknown asset or track');
      const src = Math.max(0.1, asset.duration || 0.1);
      const reqDur = Number(body.duration);
      const dur = Number.isFinite(reqDur) && reqDur > 0
        ? reqDur : (asset.kind === 'video' || asset.kind === 'audio' ? src : Math.min(src, 4));
      const clip: Clip = {
        id: uid(), trackId: body.trackId, assetId: body.assetId, name: asset.name,
        start: Math.max(0, Number(body.start) || 0), duration: Math.min(src, dur),
        inPoint: 0, sourceDuration: src,
        opacity: 1, x: 0, y: 0, scale: 1, rotation: 0,
        fadeIn: 0, fadeOut: 0, transIn: 'none', transInDur: 0.5, transOut: 'none', transOutDur: 0.5,
        loop: false, hue: asset.hue ?? 210, brightness: 1, saturation: 1, contrast: 1, temperature: 0,
        filter: 'none', color: asset.color ?? '#3b82f6', src: asset.url ?? null,
        text: asset.kind === 'text' ? (asset.text ?? asset.name ?? 'Text') : '',
        fontSize: 64, fontColor: '#ffffff', align: 'center', fontWeight: 700, fontFamily: 'system',
        muted: false, audioOnly: asset.kind === 'audio', volume: 1, keyframes: [],
      };
      proj.clips.push(clip); rippleTrack(proj, body.trackId); proj.updatedAt = stamp(); added = clip;
    });
    return { clip: added! };
  },

  patchClip(id: string, body: Partial<Clip>) {
    const NUMS = ['start','duration','inPoint','opacity','x','y','scale','rotation','fadeIn','fadeOut',
      'transInDur','transOutDur','hue','brightness','saturation','contrast','temperature','fontSize','fontWeight','volume'];
    let updated: Clip | null = null;
    commit((db) => {
      const proj = currentProj(db);
      const clip = proj.clips.find((c) => c.id === id);
      if (!clip) throw new Error('clip not found');
      const b = body as Record<string, unknown>;
      const c = clip as unknown as Record<string, unknown>;
      for (const k of NUMS) { if (b[k] !== undefined) c[k] = Number(b[k]); }
      if (body.trackId !== undefined) clip.trackId = body.trackId;
      if (body.filter !== undefined) clip.filter = String(body.filter);
      if (body.loop !== undefined) clip.loop = Boolean(body.loop);
      if (body.muted !== undefined) clip.muted = Boolean(body.muted);
      if (body.audioOnly !== undefined) clip.audioOnly = Boolean(body.audioOnly);
      if (body.text !== undefined) clip.text = String(body.text);
      if (body.fontColor !== undefined) clip.fontColor = String(body.fontColor);
      if (body.align !== undefined) clip.align = body.align;
      if (body.fontFamily !== undefined) clip.fontFamily = String(body.fontFamily);
      if (body.keyframes !== undefined) clip.keyframes = body.keyframes;
      clip.inPoint = Math.max(0, Math.min(clip.inPoint, clip.sourceDuration - 0.1));
      const maxDur = clip.loop ? 3600 : clip.sourceDuration - clip.inPoint;
      clip.duration = Math.max(0.1, Math.min(clip.duration, maxDur));
      clip.start = Math.max(0, clip.start);
      if (['start','duration','inPoint','trackId'].some((k) => b[k] !== undefined)) rippleTrack(proj, clip.trackId);
      proj.updatedAt = stamp(); updated = clip;
    });
    return { clip: updated! };
  },

  deleteClip(id: string) {
    commit((db) => { const proj = currentProj(db); proj.clips = proj.clips.filter((c) => c.id !== id); proj.updatedAt = stamp(); });
    return { ok: true as const };
  },

  addAsset(body: { name?: string; kind?: string; hue?: number; color?: string; duration?: number; text?: string }) {
    const { name = 'Untitled', kind = 'procedural', hue = 210, color, duration, text } = body;
    const asset: Asset = kind === 'text'
      ? { id: uid(), name: name || 'Text', kind: 'text', color: color || '#d6a23a', duration: Number(duration) || 600, text: text ?? name ?? 'Text' }
      : { id: uid(), name, kind: 'procedural', hue: Number(hue), color: color || '#3b82f6', duration: Number(duration) || 8 };
    commit((db) => { currentProj(db).assets.push(asset); });
    return { asset };
  },

  addUploadedAsset(asset: Asset) {
    commit((db) => { currentProj(db).assets.push(asset); });
    return { asset };
  },

  addAgent(body: { name: string; kind: AgentKind; role: string; color: string }) {
    const agent: Agent = { id: uid(), ...body, status: 'idle', isHead: false };
    commit((db) => { currentProj(db).agents.push(agent); });
    return { agent };
  },

  patchAgent(id: string, body: Partial<Agent>) {
    let updated: Agent | null = null;
    commit((db) => {
      const proj = currentProj(db); const idx = proj.agents.findIndex((a) => a.id === id);
      if (idx < 0) throw new Error('not found');
      proj.agents[idx] = { ...proj.agents[idx], ...body }; updated = proj.agents[idx];
    });
    return { agent: updated! };
  },

  addTask(body: Partial<Task>) {
    const now = stamp();
    const task: Task = {
      id: uid(), title: 'Untitled', detail: '', assigneeId: null,
      status: 'backlog', priority: 'med', tags: [], createdAt: now, updatedAt: now, ...body,
    };
    commit((db) => { currentProj(db).tasks.push(task); });
    return { task };
  },

  patchTask(id: string, body: Partial<Task>) {
    let updated: Task | null = null;
    commit((db) => {
      const proj = currentProj(db); const idx = proj.tasks.findIndex((t) => t.id === id);
      if (idx < 0) throw new Error('not found');
      proj.tasks[idx] = { ...proj.tasks[idx], ...body, updatedAt: stamp() }; updated = proj.tasks[idx];
    });
    return { task: updated! };
  },

  deleteTask(id: string) {
    commit((db) => { const proj = currentProj(db); proj.tasks = proj.tasks.filter((t) => t.id !== id); });
    return { ok: true as const };
  },
};
