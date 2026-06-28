import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'deckstop.json');

const id = (p) => `${p}_${nanoid(8)}`;
const now = () => new Date().toISOString();

// ---- project factories -------------------------------------------------
// A fresh, empty project: three standard lanes and no clips. Used for the
// "New project" action.
export function blankProject(opts = {}) {
  return {
    id: id('prj'),
    name: (opts.name && String(opts.name).slice(0, 80)) || 'Untitled',
    fps: Number(opts.fps) || 30,
    width: Number(opts.width) || 1280,
    height: Number(opts.height) || 720,
    tracks: [
      { id: id('trk'), name: 'V2', index: 0, kind: 'video' },
      { id: id('trk'), name: 'V1', index: 1, kind: 'video' },
      { id: id('trk'), name: 'A1', index: 2, kind: 'audio' },
    ],
    clips: [],
    // Media bin is per-project: a brand-new project starts empty so imported
    // media stays with the project it was added to.
    assets: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

// A deep copy of a project with fresh ids. Tracks are re-keyed and every clip
// is repointed at its cloned track so the duplicate is fully independent.
export function cloneProject(src, name) {
  const trackMap = {};
  const tracks = src.tracks.map((t) => {
    const nt = { ...t, id: id('trk') };
    trackMap[t.id] = nt.id;
    return nt;
  });
  const clips = (src.clips || []).map((c) => ({
    ...c,
    id: id('clp'),
    trackId: trackMap[c.trackId] || c.trackId,
  }));
  // Copy the source's media bin so the duplicate's clips still resolve their
  // assets. Asset ids are kept (they're scoped to this project) so no clip
  // needs repointing.
  const assets = (src.assets || []).map((a) => ({ ...a }));
  return {
    id: id('prj'),
    name: name || `${src.name} copy`,
    fps: src.fps,
    width: src.width,
    height: src.height,
    tracks,
    clips,
    assets,
    createdAt: now(),
    updatedAt: now(),
  };
}

// ---- seed --------------------------------------------------------------
function seed() {
  const assets = [
    { id: id('ast'), name: 'Aurora', kind: 'procedural', hue: 200, color: '#3b82f6', duration: 12 },
    { id: id('ast'), name: 'Ember', kind: 'procedural', hue: 18, color: '#f97316', duration: 9 },
    { id: id('ast'), name: 'Moss', kind: 'procedural', hue: 140, color: '#22c55e', duration: 14 },
    { id: id('ast'), name: 'Violet Haze', kind: 'procedural', hue: 280, color: '#a855f7', duration: 8 },
    { id: id('ast'), name: 'Slate Bars', kind: 'procedural', hue: 220, color: '#64748b', duration: 20 },
  ];

  const tracks = [
    { id: id('trk'), name: 'V3', index: 0, kind: 'video' },
    { id: id('trk'), name: 'V2', index: 1, kind: 'video' },
    { id: id('trk'), name: 'V1', index: 2, kind: 'video' },
    { id: id('trk'), name: 'A1', index: 3, kind: 'audio' },
  ];

  const mk = (assetId, trackId, start, inPoint, duration, extra = {}) => {
    const a = assets.find((x) => x.id === assetId);
    return {
      id: id('clp'),
      trackId,
      assetId,
      name: a.name,
      start,
      duration,
      inPoint,
      sourceDuration: a.duration,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
      hue: a.hue,
      brightness: 1,
      saturation: 1,
      contrast: 1,
      temperature: 0,
      filter: 'none',
      color: a.color,
      muted: false,
      audioOnly: false,
      ...extra,
    };
  };

  const clips = [
    mk(assets[0].id, tracks[2].id, 0, 0, 6, { fadeIn: 0.5 }),
    mk(assets[1].id, tracks[2].id, 6.2, 1, 5),
    mk(assets[2].id, tracks[2].id, 11.6, 0, 7, { fadeOut: 0.6 }),
    mk(assets[3].id, tracks[1].id, 3, 0, 4.5, { opacity: 0.7, scale: 0.55, x: 0.32, y: -0.3 }),
  ];

  const agents = [
    { id: 'agent_head', name: 'Claude Opus 4.8', kind: 'claude', role: 'Lead / orchestrator', status: 'working', color: '#d97757', isHead: true },
    { id: id('agt'), name: 'Claude Worker', kind: 'claude', role: 'Frontend & WebGPU', status: 'idle', color: '#c2845c', isHead: false },
    { id: id('agt'), name: 'Codex Worker', kind: 'codex', role: 'Backend & API', status: 'idle', color: '#10a37f', isHead: false },
    { id: id('agt'), name: 'You', kind: 'human', role: 'Director', status: 'idle', color: '#64748b', isHead: false },
  ];
  const [head, claudeW, codexW] = agents;

  const tasks = [
    { id: id('tsk'), title: 'Stand up WebGPU compositor', detail: 'Multi-layer alpha blend with per-clip opacity, transform, and fades. Canvas2D fallback.', assigneeId: claudeW.id, status: 'done', priority: 'high', tags: ['render'], createdAt: now(), updatedAt: now() },
    { id: id('tsk'), title: 'Trim handles on timeline clips', detail: 'Drag edges to adjust in-point and duration, clamped to source length. Snapping to neighbors and playhead.', assigneeId: claudeW.id, status: 'in_progress', priority: 'high', tags: ['timeline'], createdAt: now(), updatedAt: now() },
    { id: id('tsk'), title: 'Clip CRUD + persistence API', detail: 'REST endpoints for add / move / trim / delete, JSON-backed, broadcast over WebSocket.', assigneeId: codexW.id, status: 'review', priority: 'high', tags: ['backend'], createdAt: now(), updatedAt: now() },
    { id: id('tsk'), title: 'Image asset upload', detail: 'Upload images into the media bin and sample them as WebGPU textures.', assigneeId: codexW.id, status: 'queued', priority: 'med', tags: ['backend', 'render'], createdAt: now(), updatedAt: now() },
    { id: id('tsk'), title: 'Audio track + waveform', detail: 'Add an audio track type and draw waveforms. Scoped for the next milestone.', assigneeId: null, status: 'backlog', priority: 'low', tags: ['timeline', 'audio'], createdAt: now(), updatedAt: now() },
    { id: id('tsk'), title: 'Define v1 milestone scope', detail: 'Head sets the build plan and hands work to the agent pool.', assigneeId: head.id, status: 'done', priority: 'high', tags: ['planning'], createdAt: now(), updatedAt: now() },
  ];

  const project = {
    id: id('prj'),
    name: 'Untitled Deck',
    fps: 30,
    width: 1280,
    height: 720,
    tracks,
    clips,
    assets, // media bin lives on the project
    createdAt: now(),
    updatedAt: now(),
  };

  return {
    rev: 1,
    currentProjectId: project.id,
    projects: [project],
    agents,
    tasks,
  };
}

// ---- migration ---------------------------------------------------------
// Earlier builds stored a single project at the top level as `{ project, clips }`.
// Fold that into the multi-project shape without dropping any data so an
// existing data file (or a concurrent session's work) survives the upgrade.
function migrate(raw) {
  if (raw && Array.isArray(raw.projects) && raw.projects.length) {
    if (!raw.currentProjectId || !raw.projects.some((p) => p.id === raw.currentProjectId)) {
      raw.currentProjectId = raw.projects[0].id;
    }
    // Assets used to live globally on `raw.assets`, shared by every project.
    // Move the media bin onto each project: any project that doesn't yet have
    // its own `assets` inherits a copy of the old global bin so its existing
    // clips still resolve. New projects created from here on start empty.
    const legacy = Array.isArray(raw.assets) ? raw.assets : [];
    for (const p of raw.projects) {
      if (!Array.isArray(p.assets)) p.assets = legacy.map((a) => ({ ...a }));
    }
    delete raw.assets;
    return raw;
  }
  if (raw && raw.project) {
    const project = {
      ...raw.project,
      clips: Array.isArray(raw.clips) ? raw.clips : [],
      assets: Array.isArray(raw.project.assets)
        ? raw.project.assets
        : (Array.isArray(raw.assets) ? raw.assets : []),
      createdAt: raw.project.createdAt || now(),
      updatedAt: raw.project.updatedAt || now(),
    };
    return {
      rev: raw.rev || 1,
      currentProjectId: project.id,
      projects: [project],
      agents: raw.agents || [],
      tasks: raw.tasks || [],
    };
  }
  return null;
}

// ---- persistence -------------------------------------------------------
let db;

function load() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(DB_PATH)) {
    try {
      const migrated = migrate(JSON.parse(readFileSync(DB_PATH, 'utf8')));
      if (migrated) {
        db = migrated;
        persist();
        return;
      }
    } catch {
      // fall through to reseed on corrupt file
    }
  }
  db = seed();
  persist();
}

function persist() {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

load();

// ---- accessors / mutators ---------------------------------------------
export const newId = id;
export const stamp = now;

// The project the editor is currently pointed at (falls back to the first).
export function currentProject(database = db) {
  return database.projects.find((p) => p.id === database.currentProjectId) || database.projects[0];
}

const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)(\?|#|$)/i;
function isVisualAsset(asset) {
  if (!asset) return false;
  if (asset.kind === 'audio') return false;
  // Older uploaded audio can be stored as an image; mirror the client's
  // extension-based normalization so audio never becomes a fake poster layer.
  if (asset.kind === 'image' && asset.url && AUDIO_RE.test(asset.url)) return false;
  return true;
}

function isActiveAt(clip, t) {
  return t >= clip.start && t < clip.start + clip.duration;
}

function posterTime(visualClips, assetById) {
  const candidates = [];
  for (const clip of visualClips) {
    const duration = Math.max(0, Number(clip.duration) || 0);
    if (duration <= 0) continue;
    const safeEnd = Math.max(0.01, duration - 0.01);
    candidates.push(clip.start + Math.min(safeEnd, Math.max(0.01, duration * 0.5)));
    candidates.push(clip.start + Math.min(safeEnd, Math.max(0.01, duration * 0.25)));
  }
  let best = candidates[0] ?? 0;
  let bestScore = -1;
  for (const t of candidates) {
    let score = 0;
    for (const clip of visualClips) {
      if (!isActiveAt(clip, t)) continue;
      const kind = assetById.get(clip.assetId)?.kind;
      score += 1;
      if (kind === 'image' || kind === 'video') score += 0.5;
      if (kind === 'text') score += 0.25;
    }
    if (score > bestScore || (score === bestScore && t < best)) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

function projectPoster(project) {
  const assets = project.assets || [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const visualClips = (project.clips || []).filter((clip) => isVisualAsset(assetById.get(clip.assetId)));
  if (!visualClips.length) return null;

  const playhead = posterTime(visualClips, assetById);
  const clips = visualClips.filter((clip) => isActiveAt(clip, playhead));
  if (!clips.length) return null;

  const assetIds = new Set(clips.map((clip) => clip.assetId));
  return {
    playhead,
    tracks: (project.tracks || []).map((track) => ({ ...track })),
    clips: clips.map((clip) => ({ ...clip })),
    assets: assets.filter((asset) => assetIds.has(asset.id)).map((asset) => ({ ...asset })),
  };
}

// The wire state. The active project is flattened to the legacy
// `{ project, clips }` shape so existing clients keep working, with a
// lightweight `projects` summary + `currentProjectId` added for the switcher.
export function getState() {
  const cur = currentProject();
  return {
    rev: db.rev,
    project: {
      id: cur.id,
      name: cur.name,
      fps: cur.fps,
      width: cur.width,
      height: cur.height,
      tracks: cur.tracks,
    },
    clips: cur.clips,
    assets: cur.assets || [],
    agents: db.agents,
    tasks: db.tasks,
    currentProjectId: db.currentProjectId,
    projects: db.projects.map((p) => ({
      id: p.id,
      name: p.name,
      fps: p.fps,
      width: p.width,
      height: p.height,
      clipCount: (p.clips || []).length,
      trackCount: (p.tracks || []).length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      poster: projectPoster(p),
    })),
  };
}

export function commit(mutator) {
  mutator(db);
  db.rev += 1;
  persist();
  return db;
}

export function resetDb() {
  db = seed();
  persist();
  return db;
}
