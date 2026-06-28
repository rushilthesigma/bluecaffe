import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { getState, commit, resetDb, newId, stamp, currentProject, blankProject, cloneProject } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const PORT = process.env.PORT || 5401;
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---- websocket broadcast ----------------------------------------------
function broadcast() {
  const msg = JSON.stringify({ type: 'state', state: getState() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', state: getState() }));
});

const ok = (res, extra = {}) => res.json({ ok: true, rev: getState().rev, ...extra });

// Keep clips on a single track from overlapping. Walking the track left to
// right, whenever one clip's end runs past the next clip's start, push that
// next clip so it begins at the previous clip's end. Sub-frame gaps are also
// treated as joins; deliberate larger gaps stay intact.
const TINY_GAP_EPS = 1 / 120;
function rippleTrack(proj, trackId) {
  const lane = proj.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  let hasPrevious = false;
  for (const c of lane) {
    if (hasPrevious && c.start - cursor <= TINY_GAP_EPS) c.start = cursor;
    cursor = c.start + c.duration;
    hasPrevious = true;
  }
}

// ---- full state --------------------------------------------------------
app.get('/api/state', (_req, res) => res.json(getState()));

// ---- projects ----------------------------------------------------------
// Every project is fully self-contained: its own timeline (tracks + clips) and
// its own media bin (assets). Imported media stays with the project it was
// added to, so a new project starts empty. Editing endpoints below always act
// on the project named by `currentProjectId`.
app.get('/api/projects', (_req, res) => {
  const s = getState();
  res.json({ projects: s.projects, currentProjectId: s.currentProjectId });
});

// create a fresh, empty project and switch to it
app.post('/api/projects', (req, res) => {
  let created = null;
  commit((db) => {
    created = blankProject(req.body || {});
    db.projects.push(created);
    db.currentProjectId = created.id;
  });
  broadcast();
  ok(res, { project: created });
});

// switch the editor to an existing project
app.post('/api/projects/:id/open', (req, res) => {
  const exists = getState().projects.some((p) => p.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'unknown project' });
  commit((db) => { db.currentProjectId = req.params.id; });
  broadcast();
  ok(res);
});

// deep-copy a project (fresh ids) and switch to the copy
app.post('/api/projects/:id/duplicate', (req, res) => {
  let created = null;
  commit((db) => {
    const src = db.projects.find((p) => p.id === req.params.id);
    if (!src) return;
    created = cloneProject(src, req.body && req.body.name);
    db.projects.push(created);
    db.currentProjectId = created.id;
  });
  if (!created) return res.status(404).json({ error: 'not found' });
  broadcast();
  ok(res, { project: created });
});

// rename / reconfigure a project's canvas
const PROJ_NUMERIC = ['fps', 'width', 'height'];
app.patch('/api/projects/:id', (req, res) => {
  let updated = null;
  commit((db) => {
    const p = db.projects.find((x) => x.id === req.params.id);
    if (!p) return;
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 80);
      if (name) p.name = name;
    }
    for (const key of PROJ_NUMERIC) {
      if (req.body[key] !== undefined) p[key] = Number(req.body[key]) || p[key];
    }
    p.updatedAt = stamp();
    updated = p;
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  broadcast();
  ok(res, { project: updated });
});

// delete a project; the last remaining one can't be removed
app.delete('/api/projects/:id', (req, res) => {
  const state = getState();
  if (!state.projects.some((p) => p.id === req.params.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  if (state.projects.length <= 1) {
    return res.status(400).json({ error: 'cannot delete the last project' });
  }
  commit((db) => {
    db.projects = db.projects.filter((p) => p.id !== req.params.id);
    if (db.currentProjectId === req.params.id) db.currentProjectId = db.projects[0].id;
  });
  broadcast();
  ok(res);
});

// ---- tracks ------------------------------------------------------------
app.post('/api/tracks', (req, res) => {
  let created = null;
  commit((db) => {
    const proj = currentProject(db);
    const tracks = proj.tracks;
    const kind = req.body.kind === 'audio' ? 'audio' : 'video';
    if (kind === 'audio') {
      const n = tracks.filter((t) => t.kind === 'audio' || /^A\d+/i.test(t.name || '')).length + 1;
      created = { id: newId('trk'), name: req.body.name || `A${n}`, index: tracks.length, kind };
      tracks.push(created);
    } else {
      for (const t of tracks) t.index += 1;           // existing tracks drop one layer
      created = { id: newId('trk'), name: req.body.name || `V${tracks.length + 1}`, index: 0, kind };
      tracks.unshift(created);                        // new track sits on top
    }
    proj.updatedAt = stamp();
  });
  broadcast();
  ok(res, { track: created });
});

// ---- clips -------------------------------------------------------------
app.post('/api/clips', (req, res) => {
  const { assetId, trackId, start = 0, duration } = req.body;
  const state = getState();
  const asset = state.assets.find((a) => a.id === assetId);
  const track = state.project.tracks.find((t) => t.id === trackId);
  if (!asset || !track) return res.status(400).json({ error: 'unknown asset or track' });
  const sourceDuration = Math.max(0.1, Number(asset.duration) || 0.1);
  const requestedDuration = Number(duration);
  const defaultDuration = asset.kind === 'video' || asset.kind === 'audio'
    ? sourceDuration
    : Math.min(sourceDuration, 4);
  const clipDuration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : defaultDuration;

  const clip = {
    id: newId('clp'),
    trackId,
    assetId,
    name: asset.name,
    start: Math.max(0, Number(start) || 0),
    duration: Math.min(sourceDuration, clipDuration),
    inPoint: 0,
    sourceDuration,
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    fadeIn: 0,
    fadeOut: 0,
    transIn: 'none',
    transInDur: 0.5,
    transOut: 'none',
    transOutDur: 0.5,
    loop: false,
    hue: asset.hue ?? 210,
    brightness: 1,
    saturation: 1,
    contrast: 1,
    temperature: 0,
    filter: 'none',
    color: asset.color ?? '#3b82f6',
    src: asset.url ?? null,
    // text overlay defaults (only meaningful when the asset is a text title)
    text: asset.kind === 'text' ? (req.body.text ?? asset.text ?? asset.name ?? 'Text') : '',
    fontSize: 64,
    fontColor: '#ffffff',
    align: 'center',
    fontWeight: 700,
    fontFamily: 'system',
    muted: false,
    audioOnly: asset.kind === 'audio',
    volume: 1,
    // per-property animation keyframes; empty until the user adds some
    keyframes: [],
  };
  commit((db) => {
    const proj = currentProject(db);
    proj.clips.push(clip);
    rippleTrack(proj, trackId);
    proj.updatedAt = stamp();
  });
  broadcast();
  ok(res, { clip });
});

const NUMERIC = ['start', 'duration', 'inPoint', 'opacity', 'x', 'y', 'scale', 'rotation', 'fadeIn', 'fadeOut', 'transInDur', 'transOutDur', 'hue', 'brightness', 'saturation', 'contrast', 'temperature', 'fontSize', 'fontWeight', 'volume'];
const TRANSITIONS = new Set(['none', 'push-up', 'push-down', 'push-left', 'push-right', 'fade', 'dissolve']);
const KEYABLE_PROPS = new Set(['opacity', 'scale', 'x', 'y']);
const EASES = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'hold']);

// Sanitize an incoming keyframe array: keep only known props/eases, coerce
// numbers, mint ids for any missing, and cap the count.
function cleanKeyframes(raw) {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((k) => k && KEYABLE_PROPS.has(k.prop))
    .slice(0, 240)
    .map((k) => ({
      id: typeof k.id === 'string' && k.id ? k.id : newId('kf'),
      prop: k.prop,
      t: Math.max(0, Number(k.t) || 0),
      value: Number(k.value) || 0,
      ease: EASES.has(k.ease) ? k.ease : 'ease',
    }));
}

app.patch('/api/clips/:id', (req, res) => {
  let updated = null;
  commit((db) => {
    const proj = currentProject(db);
    const clip = proj.clips.find((c) => c.id === req.params.id);
    if (!clip) return;
    for (const key of NUMERIC) {
      if (req.body[key] !== undefined) clip[key] = Number(req.body[key]);
    }
    if (req.body.trackId !== undefined) clip.trackId = req.body.trackId;
    if (req.body.filter !== undefined) clip.filter = String(req.body.filter);
    if (req.body.loop !== undefined) clip.loop = Boolean(req.body.loop);
    if (req.body.muted !== undefined) clip.muted = Boolean(req.body.muted);
    if (req.body.audioOnly !== undefined) clip.audioOnly = Boolean(req.body.audioOnly);
    // push transitions: only accept known directions
    if (req.body.transIn !== undefined && TRANSITIONS.has(req.body.transIn)) clip.transIn = req.body.transIn;
    if (req.body.transOut !== undefined && TRANSITIONS.has(req.body.transOut)) clip.transOut = req.body.transOut;
    // text overlay fields
    if (req.body.text !== undefined) clip.text = String(req.body.text);
    if (req.body.fontColor !== undefined) clip.fontColor = String(req.body.fontColor);
    if (req.body.align !== undefined) clip.align = String(req.body.align);
    if (req.body.fontFamily !== undefined) clip.fontFamily = String(req.body.fontFamily);
    // animation keyframes
    if (req.body.keyframes !== undefined) {
      const kf = cleanKeyframes(req.body.keyframes);
      if (kf) clip.keyframes = kf;
    }
    // keep trims sane
    clip.inPoint = Math.max(0, Math.min(clip.inPoint, clip.sourceDuration - 0.1));
    // a looping clip may run longer than its source (it repeats); otherwise it's capped to the source
    const maxDur = clip.loop ? 3600 : clip.sourceDuration - clip.inPoint;
    clip.duration = Math.max(0.1, Math.min(clip.duration, maxDur));
    clip.start = Math.max(0, clip.start);
    // if this clip moved or resized, shove any clips it now overlaps
    if (['start', 'duration', 'inPoint', 'trackId'].some((k) => req.body[k] !== undefined)) {
      rippleTrack(proj, clip.trackId);
    }
    proj.updatedAt = stamp();
    updated = clip;
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  broadcast();
  ok(res, { clip: updated });
});

app.delete('/api/clips/:id', (req, res) => {
  commit((db) => {
    const proj = currentProject(db);
    proj.clips = proj.clips.filter((c) => c.id !== req.params.id);
    proj.updatedAt = stamp();
  });
  broadcast();
  ok(res);
});

// ---- assets ------------------------------------------------------------
app.post('/api/assets', (req, res) => {
  const { name = 'Untitled', kind = 'procedural', hue = 210, color, duration, text } = req.body;
  // a text asset is a reusable title; its content seeds the clips dropped from it.
  // duration is large so text clips can be stretched to any length on a track.
  const asset = kind === 'text'
    ? { id: newId('ast'), name: name || 'Text', kind: 'text', color: color || '#d6a23a', duration: Number(duration) || 600, text: text ?? name ?? 'Text' }
    : { id: newId('ast'), name, kind: 'procedural', hue: Number(hue), color: color || '#3b82f6', duration: Number(duration) || 8 };
  commit((db) => currentProject(db).assets.push(asset));
  broadcast();
  ok(res, { asset });
});

app.post('/api/assets/:id/audio', (req, res) => {
  let asset = null;
  commit((db) => {
    const proj = currentProject(db);
    const src = (proj.assets || []).find((a) => a.id === req.params.id);
    if (!src || src.kind !== 'video' || !src.url) return;
    const existing = proj.assets.find((a) => a.kind === 'audio' && a.sourceAssetId === src.id);
    if (existing) {
      asset = existing;
      return;
    }
    asset = {
      id: newId('ast'),
      name: req.body.name || `${src.name || 'Video'} Audio`,
      kind: 'audio',
      url: src.url,
      color: '#46b88a',
      duration: Number(src.duration) || 10,
      width: null,
      height: null,
      sourceAssetId: src.id,
    };
    proj.assets.push(asset);
    proj.updatedAt = stamp();
  });
  if (!asset) return res.status(400).json({ error: 'video asset not found' });
  broadcast();
  ok(res, { asset });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const prefix = (file.mimetype || '').startsWith('video') ? 'vid' : 'img';
      cb(null, `${newId(prefix)}${extname(file.originalname) || ''}`);
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
});

app.post('/api/assets/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const isVideo = (req.file.mimetype || '').startsWith('video');
  const asset = {
    id: newId('ast'),
    name: req.body.name || req.file.originalname,
    kind: isVideo ? 'video' : 'image',
    url: `/uploads/${req.file.filename}`,
    color: isVideo ? '#6b8aa8' : '#94a3b8',
    duration: Number(req.body.duration) || (isVideo ? 10 : 6),
    width: Number(req.body.width) || null,
    height: Number(req.body.height) || null,
  };
  commit((db) => currentProject(db).assets.push(asset));
  broadcast();
  ok(res, { asset });
});

// ---- agents ------------------------------------------------------------
app.post('/api/agents', (req, res) => {
  const { name = 'Agent', kind = 'claude', role = '', color = '#64748b' } = req.body;
  const agent = { id: newId('agt'), name, kind, role, status: 'idle', color, isHead: false };
  commit((db) => db.agents.push(agent));
  broadcast();
  ok(res, { agent });
});

app.patch('/api/agents/:id', (req, res) => {
  let updated = null;
  commit((db) => {
    const agent = db.agents.find((a) => a.id === req.params.id);
    if (!agent) return;
    for (const key of ['name', 'role', 'status', 'color', 'kind']) {
      if (req.body[key] !== undefined) agent[key] = req.body[key];
    }
    updated = agent;
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  broadcast();
  ok(res, { agent: updated });
});

// ---- tasks -------------------------------------------------------------
app.post('/api/tasks', (req, res) => {
  const { title = 'New task', detail = '', assigneeId = null, status = 'backlog', priority = 'med', tags = [] } = req.body;
  const task = { id: newId('tsk'), title, detail, assigneeId, status, priority, tags, createdAt: stamp(), updatedAt: stamp() };
  commit((db) => db.tasks.unshift(task));
  broadcast();
  ok(res, { task });
});

app.patch('/api/tasks/:id', (req, res) => {
  let updated = null;
  commit((db) => {
    const task = db.tasks.find((t) => t.id === req.params.id);
    if (!task) return;
    for (const key of ['title', 'detail', 'assigneeId', 'status', 'priority', 'tags']) {
      if (req.body[key] !== undefined) task[key] = req.body[key];
    }
    task.updatedAt = stamp();
    updated = task;
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  broadcast();
  ok(res, { task: updated });
});

app.delete('/api/tasks/:id', (req, res) => {
  commit((db) => {
    db.tasks = db.tasks.filter((t) => t.id !== req.params.id);
  });
  broadcast();
  ok(res);
});

// ---- dev reset ---------------------------------------------------------
app.post('/api/reset', (_req, res) => {
  resetDb();
  broadcast();
  ok(res);
});

server.listen(PORT, () => {
  console.log(`[deckstop] api + ws on http://localhost:${PORT}`);
});
