import type { Asset, Clip, Agent, Task, Track, ProjectSummary } from './types';

async function req<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  // projects
  addProject: (body: { name?: string; fps?: number; width?: number; height?: number } = {}) =>
    req<{ project: ProjectSummary }>('/api/projects', 'POST', body),
  openProject: (id: string) => req<{ ok: true }>(`/api/projects/${id}/open`, 'POST', {}),
  duplicateProject: (id: string, body: { name?: string } = {}) =>
    req<{ project: ProjectSummary }>(`/api/projects/${id}/duplicate`, 'POST', body),
  updateProject: (id: string, body: { name?: string; fps?: number; width?: number; height?: number }) =>
    req<{ project: ProjectSummary }>(`/api/projects/${id}`, 'PATCH', body),
  renameProject: (id: string, name: string) =>
    req<{ project: ProjectSummary }>(`/api/projects/${id}`, 'PATCH', { name }),
  deleteProject: (id: string) => req<{ ok: true }>(`/api/projects/${id}`, 'DELETE'),

  // tracks
  addTrack: (body: { name?: string; kind?: Track['kind'] } = {}) => req<{ track: Track }>('/api/tracks', 'POST', body),

  // clips
  addClip: (body: { assetId: string; trackId: string; start: number; duration?: number }) =>
    req<{ clip: Clip }>('/api/clips', 'POST', body),
  patchClip: (id: string, body: Partial<Clip>) =>
    req<{ clip: Clip }>(`/api/clips/${id}`, 'PATCH', body),
  deleteClip: (id: string) => req<{ ok: true }>(`/api/clips/${id}`, 'DELETE'),

  // assets
  addAsset: (body: { name: string; hue: number; color: string; duration: number }) =>
    req<{ asset: Asset }>('/api/assets', 'POST', body),
  addText: (body: { name?: string; text?: string; color?: string } = {}) =>
    req<{ asset: Asset }>('/api/assets', 'POST', { name: 'Text', text: 'Your text', ...body, kind: 'text', duration: 600 }),
  deriveAudioAsset: (id: string, body: { name?: string } = {}) =>
    req<{ asset: Asset }>(`/api/assets/${id}/audio`, 'POST', body),
  uploadAsset: async (file: File, meta?: { duration?: number; width?: number; height?: number }) => {
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
    req<{ agent: Agent }>('/api/agents', 'POST', body),
  patchAgent: (id: string, body: Partial<Agent>) =>
    req<{ agent: Agent }>(`/api/agents/${id}`, 'PATCH', body),

  // tasks
  addTask: (body: Partial<Task>) => req<{ task: Task }>('/api/tasks', 'POST', body),
  patchTask: (id: string, body: Partial<Task>) =>
    req<{ task: Task }>(`/api/tasks/${id}`, 'PATCH', body),
  deleteTask: (id: string) => req<{ ok: true }>(`/api/tasks/${id}`, 'DELETE'),
};
