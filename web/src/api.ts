import type { Asset, Clip, Agent, Task, Track, ProjectSummary } from './types';
import { localEngine, uid } from './local/engine';

async function req<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

let LOCAL = false;
export function enableLocalMode() { LOCAL = true; }

function lo<T>(fn: () => T): Promise<T> {
  try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); }
}

// Detect duration of a local media file via HTML5 element.
function detectDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const tag = file.type.startsWith('audio') ? 'audio' : 'video';
    const el = document.createElement(tag) as HTMLMediaElement;
    el.onloadedmetadata = () => { URL.revokeObjectURL(el.src); resolve(isFinite(el.duration) ? el.duration : 8); };
    el.onerror = () => resolve(8);
    el.src = URL.createObjectURL(file);
  });
}

export const api = {
  // projects
  addProject: (body: { name?: string; fps?: number; width?: number; height?: number } = {}) =>
    LOCAL ? lo(() => localEngine.addProject(body)) : req<{ project: ProjectSummary }>('/api/projects', 'POST', body),

  openProject: (id: string) =>
    LOCAL ? lo(() => localEngine.openProject(id)) : req<{ ok: true }>(`/api/projects/${id}/open`, 'POST', {}),

  duplicateProject: (id: string, body: { name?: string } = {}) =>
    LOCAL ? lo(() => localEngine.duplicateProject(id, body)) : req<{ project: ProjectSummary }>(`/api/projects/${id}/duplicate`, 'POST', body),

  updateProject: (id: string, body: { name?: string; fps?: number; width?: number; height?: number }) =>
    LOCAL ? lo(() => localEngine.updateProject(id, body)) : req<{ project: ProjectSummary }>(`/api/projects/${id}`, 'PATCH', body),

  renameProject: (id: string, name: string) =>
    LOCAL ? lo(() => localEngine.updateProject(id, { name })) : req<{ project: ProjectSummary }>(`/api/projects/${id}`, 'PATCH', { name }),

  deleteProject: (id: string) =>
    LOCAL ? lo(() => localEngine.deleteProject(id)) : req<{ ok: true }>(`/api/projects/${id}`, 'DELETE'),

  // tracks
  addTrack: (body: { name?: string; kind?: Track['kind'] } = {}) =>
    LOCAL ? lo(() => localEngine.addTrack(body)) : req<{ track: Track }>('/api/tracks', 'POST', body),

  // clips
  addClip: (body: { assetId: string; trackId: string; start: number; duration?: number }) =>
    LOCAL ? lo(() => localEngine.addClip(body)) : req<{ clip: Clip }>('/api/clips', 'POST', body),

  patchClip: (id: string, body: Partial<Clip>) =>
    LOCAL ? lo(() => localEngine.patchClip(id, body)) : req<{ clip: Clip }>(`/api/clips/${id}`, 'PATCH', body),

  deleteClip: (id: string) =>
    LOCAL ? lo(() => localEngine.deleteClip(id)) : req<{ ok: true }>(`/api/clips/${id}`, 'DELETE'),

  // assets
  addAsset: (body: { name: string; hue: number; color: string; duration: number }) =>
    LOCAL ? lo(() => localEngine.addAsset(body)) : req<{ asset: Asset }>('/api/assets', 'POST', body),

  addText: (body: { name?: string; text?: string; color?: string } = {}) =>
    LOCAL
      ? lo(() => localEngine.addAsset({ name: 'Text', text: 'Your text', ...body, kind: 'text', duration: 600 }))
      : req<{ asset: Asset }>('/api/assets', 'POST', { name: 'Text', text: 'Your text', ...body, kind: 'text', duration: 600 }),

  deriveAudioAsset: (id: string, body: { name?: string } = {}) =>
    LOCAL
      ? Promise.reject(new Error('Audio extraction is not available in offline mode'))
      : req<{ asset: Asset }>(`/api/assets/${id}/audio`, 'POST', body),

  uploadAsset: async (file: File, meta?: { duration?: number; width?: number; height?: number }) => {
    if (LOCAL) {
      const kind = file.type.startsWith('video/') ? 'video' as const
                 : file.type.startsWith('audio/') ? 'audio' as const
                 : 'image' as const;
      const duration = meta?.duration ?? await detectDuration(file);
      const url = URL.createObjectURL(file);
      const asset: Asset = {
        id: uid(), name: file.name, kind, url,
        color: kind === 'audio' ? '#46b88a' : '#3b82f6',
        duration, width: meta?.width, height: meta?.height,
      };
      return localEngine.addUploadedAsset(asset);
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', file.name);
    if (meta?.duration) fd.append('duration', String(meta.duration));
    if (meta?.width) fd.append('width', String(meta.width));
    if (meta?.height) fd.append('height', String(meta.height));
    const res = await fetch('/api/assets/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('upload failed');
    return res.json() as Promise<{ asset: Asset }>;
  },

  // agents
  addAgent: (body: { name: string; kind: string; role: string; color: string }) =>
    LOCAL ? lo(() => localEngine.addAgent(body as Parameters<typeof localEngine.addAgent>[0])) : req<{ agent: Agent }>('/api/agents', 'POST', body),

  patchAgent: (id: string, body: Partial<Agent>) =>
    LOCAL ? lo(() => localEngine.patchAgent(id, body)) : req<{ agent: Agent }>(`/api/agents/${id}`, 'PATCH', body),

  // tasks
  addTask: (body: Partial<Task>) =>
    LOCAL ? lo(() => localEngine.addTask(body)) : req<{ task: Task }>('/api/tasks', 'POST', body),

  patchTask: (id: string, body: Partial<Task>) =>
    LOCAL ? lo(() => localEngine.patchTask(id, body)) : req<{ task: Task }>(`/api/tasks/${id}`, 'PATCH', body),

  deleteTask: (id: string) =>
    LOCAL ? lo(() => localEngine.deleteTask(id)) : req<{ ok: true }>(`/api/tasks/${id}`, 'DELETE'),
};
