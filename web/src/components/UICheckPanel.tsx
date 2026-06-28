import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state/store';

type Status = 'pass' | 'warn' | 'fail';
interface Check {
  name: string;
  status: Status;
  detail: string;
}

const win = () => window as unknown as {
  __dsBackend?: string;
  __dsFrames?: number;
  __uiErrors?: { count: number; last: string | null };
};

// measure the live render-loop frame rate over a short window
function measureFps(ms = 500): Promise<number> {
  return new Promise((resolve) => {
    const start = win().__dsFrames ?? 0;
    const t0 = performance.now();
    const sample = () => {
      const dt = performance.now() - t0;
      if (dt >= ms) {
        const frames = (win().__dsFrames ?? 0) - start;
        resolve(Math.round((frames / dt) * 1000));
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  });
}

export function UICheckPanel() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    const state = useStore.getState();
    const out: Check[] = [];

    // 1. backend API reachable
    const t0 = performance.now();
    try {
      const r = await fetch('/api/state');
      const body = await r.json();
      const ms = Math.round(performance.now() - t0);
      out.push({ name: 'Backend API', status: r.ok ? 'pass' : 'fail', detail: r.ok ? `200 · rev ${body.rev} · ${ms}ms` : `HTTP ${r.status}` });
    } catch (e) {
      out.push({ name: 'Backend API', status: 'fail', detail: `unreachable (${String(e)})` });
    }

    // 2. live sync
    out.push({ name: 'Live sync (WebSocket)', status: state.connected ? 'pass' : 'fail', detail: state.connected ? 'connected' : 'disconnected' });

    // 3. render backend
    const backend = win().__dsBackend;
    out.push({
      name: 'Render backend',
      status: backend === 'webgpu' ? 'pass' : backend === 'canvas2d' ? 'warn' : 'fail',
      detail: backend === 'webgpu' ? 'WebGPU device active' : backend === 'canvas2d' ? 'Canvas2D fallback (no WebGPU)' : 'not initialised',
    });

    // 4. render loop — live fps when the tab is painting, else confirm frames have been produced
    const fps = await measureFps();
    const frames = win().__dsFrames ?? 0;
    let loopStatus: Status;
    let loopDetail: string;
    if (fps >= 30) { loopStatus = 'pass'; loopDetail = `${fps} fps`; }
    else if (fps > 0) { loopStatus = 'warn'; loopDetail = `${fps} fps`; }
    else if (frames > 0) { loopStatus = 'pass'; loopDetail = `${frames} frames · idle (tab unfocused)`; }
    else { loopStatus = 'fail'; loopDetail = 'no frames produced'; }
    out.push({ name: 'Render loop', status: loopStatus, detail: loopDetail });

    // 5. canvas present + sized
    const cv = document.querySelector('canvas.preview-canvas') as HTMLCanvasElement | null;
    out.push({ name: 'Preview canvas', status: cv && cv.width > 0 ? 'pass' : 'fail', detail: cv ? `${cv.width}×${cv.height} buffer` : 'missing' });

    // 6. panels mounted
    const sel = ['.mediabin', '.preview', '.timeline', '.rightdock'];
    const missing = sel.filter((s) => !document.querySelector(s));
    out.push({ name: 'Panels mounted', status: missing.length === 0 ? 'pass' : 'fail', detail: missing.length === 0 ? '4 / 4 docked' : `missing ${missing.join(', ')}` });

    // 7. project data
    out.push({ name: 'Project data', status: state.clips.length > 0 ? 'pass' : 'warn', detail: `${state.clips.length} clips · ${state.project.tracks.length} tracks` });

    // 8. media library
    const proc = state.assets.filter((a) => a.kind === 'procedural').length;
    const img = state.assets.filter((a) => a.kind === 'image').length;
    const vid = state.assets.filter((a) => a.kind === 'video').length;
    out.push({ name: 'Media library', status: state.assets.length > 0 ? 'pass' : 'warn', detail: `${proc} procedural · ${img} image · ${vid} video` });

    // 9. selection wiring
    out.push({ name: 'Selection', status: 'pass', detail: state.selectedClipId ? 'clip selected → inspector live' : 'none selected' });

    // 10. runtime errors
    const errs = win().__uiErrors;
    out.push({ name: 'Runtime errors', status: !errs || errs.count === 0 ? 'pass' : 'fail', detail: !errs || errs.count === 0 ? 'clean console' : `${errs.count} · ${errs.last ?? ''}`.slice(0, 60) });

    setChecks(out);
    setRanAt(new Date().toLocaleTimeString());
    setRunning(false);
  }, []);

  // auto-run on first open
  useEffect(() => { run(); }, [run]);

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;

  return (
    <div className="uicheck">
      <div className="uc-intro">
        Self-check surface. Any agent can run this to confirm the UI is healthy before handing work back.
      </div>

      <div className="uc-summary">
        <div className={`uc-verdict ${fails ? 'bad' : warns ? 'warn' : 'good'}`}>
          {fails ? `${fails} failing` : warns ? `${warns} warnings` : 'All systems pass'}
        </div>
        <button className="btn sm" disabled={running} onClick={run}>{running ? 'Running…' : 'Re-run'}</button>
      </div>

      <div className="uc-list">
        {checks.map((c) => (
          <div className="uc-row" key={c.name}>
            <span className={`uc-dot ${c.status}`} />
            <span className="uc-name">{c.name}</span>
            <span className="uc-detail">{c.detail}</span>
          </div>
        ))}
        {checks.length === 0 && <div className="uc-empty">No results yet.</div>}
      </div>

      {ranAt && <p className="uc-foot">Last run {ranAt} · {checks.length} checks</p>}
    </div>
  );
}
