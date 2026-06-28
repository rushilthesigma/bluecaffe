import { COMPOSITOR_WGSL } from './shaders';
import { fontStack, isFontReady } from '../fonts';

export type LayerKind = 'procedural' | 'image' | 'video' | 'text';

export interface Layer {
  id: string;
  kind: LayerKind;
  hue: number; // 0..1
  brightness: number;
  saturation: number; // 0..2
  contrast: number; // 0..2
  temperature: number; // -1..1
  opacity: number;
  x: number; // NDC offset, -1..1
  y: number;
  scale: number;
  rotation: number; // degrees, clockwise, about the layer centre
  // contain-fit half-extents (1 = fills that axis). Off-16:9 media gets <1 on
  // its over-long axis so it letterboxes instead of stretching. Default 1/1.
  aspectX: number;
  aspectY: number;
  assetId: string | null;
  url?: string | null;
  time: number; // source time to display (for video)
  // visual post-effects (0 = off, 0..1 = strength)
  blur?: number;
  vignette?: number;
  grain?: number;
  pixelate?: number;
  // text layers
  text?: string;
  fontSize?: number;
  fontColor?: string;
  align?: 'left' | 'center' | 'right' | string;
  fontWeight?: number;
  fontFamily?: string; // font id from fonts.ts
  projW?: number; // authoring resolution for the text canvas
  projH?: number;
}

export interface Compositor {
  backend: 'webgpu' | 'canvas2d';
  render(layers: Layer[], playing: boolean): void;
  /** Seek all video sources to their target times and resolve when ready. Canvas2D only. */
  seekAll?: (layers: Layer[]) => Promise<void>;
  dispose(): void;
}

export const STAGE: [number, number, number, number] = [0.043, 0.05, 0.063, 1];
const MAX_LAYERS = 16;
const STRIDE = 256;

export async function createCompositor(canvas: HTMLCanvasElement): Promise<Compositor> {
  try {
    if (navigator.gpu) {
      const gpu = await createWebGPU(canvas);
      if (gpu) return gpu;
    }
  } catch (err) {
    console.warn('[deckstop] WebGPU unavailable, using Canvas2D fallback', err);
  }
  return createCanvas2D(canvas);
}

// shared: build a video element for an asset
export function makeVideo(url: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.loop = false;
  v.playsInline = true;
  v.crossOrigin = 'anonymous';
  v.preload = 'auto';
  return v;
}

// ---- text rendering ----------------------------------------------------
// a signature that captures everything affecting the rasterized text, so we
// only re-paint + re-upload the texture when the look actually changes
export function textSig(L: Layer): string {
  const w = Math.max(16, Math.round(L.projW ?? 1280));
  const h = Math.max(16, Math.round(L.projH ?? 720));
  // fold font readiness into the signature: when a web font is still loading we
  // paint a fallback, and the flag flips once it arrives so the layer re-paints.
  const ready = isFontReady(L.fontFamily, L.fontWeight ?? 700) ? '1' : '0';
  return `${w}x${h}|${L.fontSize ?? 64}|${L.fontColor ?? '#ffffff'}|${L.align ?? 'center'}|${L.fontWeight ?? 700}|${L.fontFamily ?? 'system'}|${ready}|${L.text ?? ''}`;
}

// paint a text layer onto a transparent canvas at the project's resolution.
// Drawn the same way an image is, so the compositor stacks/transforms it like
// any other textured layer.
export function paintText(cv: HTMLCanvasElement, L: Layer) {
  const w = cv.width;
  const h = cv.height;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  const text = (L.text ?? '').trim();
  if (!text) return;
  const size = Math.max(4, L.fontSize ?? 64);
  const weight = L.fontWeight ?? 700;
  ctx.font = `${weight} ${size}px ${fontStack(L.fontFamily)}`;
  ctx.fillStyle = L.fontColor ?? '#ffffff';
  ctx.textBaseline = 'middle';
  const align = (L.align ?? 'center') as CanvasTextAlign;
  ctx.textAlign = align;
  const pad = Math.round(w * 0.06);
  const x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;
  const lines = text.split('\n');
  const lh = size * 1.22;
  let y = h / 2 - (lines.length * lh) / 2 + lh / 2;
  // a restrained shadow keeps text legible over busy footage
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = Math.max(2, size * 0.06);
  ctx.shadowOffsetY = Math.max(1, size * 0.03);
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lh;
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// sync a video element to a desired source time + transport state
function syncVideo(v: HTMLVideoElement, desired: number, playing: boolean) {
  if (v.readyState < 2) return;
  if (playing) {
    if (v.paused) v.play().catch(() => {});
    if (Math.abs(v.currentTime - desired) > 0.35) v.currentTime = desired;
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - desired) > 0.04) v.currentTime = desired;
  }
}

// ---- WebGPU backend ----------------------------------------------------
async function createWebGPU(canvas: HTMLCanvasElement): Promise<Compositor | null> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;

  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const module = device.createShaderModule({ code: COMPOSITOR_WGSL });

  const uniformBGL = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 80 } }],
  });
  const texBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [uniformBGL, texBGL] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  });

  const uniformBuf = device.createBuffer({ size: STRIDE * MAX_LAYERS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cpu = new Float32Array((STRIDE / 4) * MAX_LAYERS);
  const uniformBG = device.createBindGroup({ layout: uniformBGL, entries: [{ binding: 0, resource: { buffer: uniformBuf, offset: 0, size: STRIDE } }] });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const white = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
  const texUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
  const makeTexBG = (view: GPUTextureView) => device.createBindGroup({ layout: texBGL, entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: view }] });
  const defaultTexBG = makeTexBG(white.createView());

  interface Src {
    kind: 'image' | 'video';
    bg: GPUBindGroup | null;
    tex: GPUTexture | null;
    video?: HTMLVideoElement;
    w: number;
    h: number;
  }
  const sources = new Map<string, Src>();
  const loading = new Set<string>();

  // text layers: rasterize to a shared 2D canvas, upload as a per-clip texture
  const textCanvas = document.createElement('canvas');
  interface TextSrc { sig: string; tex: GPUTexture; bg: GPUBindGroup; w: number; h: number }
  const textSources = new Map<string, TextSrc>();

  function ensureText(L: Layer): TextSrc {
    const w = Math.max(16, Math.round(L.projW ?? 1280));
    const h = Math.max(16, Math.round(L.projH ?? 720));
    const sig = textSig(L);
    const cur = textSources.get(L.id);
    if (cur && cur.sig === sig && cur.w === w && cur.h === h) return cur;
    if (textCanvas.width !== w) textCanvas.width = w;
    if (textCanvas.height !== h) textCanvas.height = h;
    paintText(textCanvas, L);
    let tex = cur?.tex;
    if (!tex || cur!.w !== w || cur!.h !== h) {
      cur?.tex.destroy();
      tex = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: texUsage });
    }
    device.queue.copyExternalImageToTexture({ source: textCanvas }, { texture: tex }, [w, h]);
    const rec: TextSrc = { sig, tex, bg: makeTexBG(tex.createView()), w, h };
    textSources.set(L.id, rec);
    return rec;
  }

  function ensureSource(assetId: string, url: string, kind: 'image' | 'video') {
    if (sources.has(assetId)) return;
    if (kind === 'video') {
      sources.set(assetId, { kind: 'video', bg: null, tex: null, video: makeVideo(url), w: 0, h: 0 });
      return;
    }
    if (loading.has(assetId)) return;
    loading.add(assetId);
    fetch(url)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none' }))
      .then((bmp) => {
        const tex = device.createTexture({ size: [bmp.width, bmp.height], format: 'rgba8unorm', usage: texUsage });
        device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
        sources.set(assetId, { kind: 'image', bg: makeTexBG(tex.createView()), tex, w: bmp.width, h: bmp.height });
        loading.delete(assetId);
      })
      .catch(() => loading.delete(assetId));
  }

  function pumpVideo(src: Src, layer: Layer, playing: boolean) {
    const v = src.video!;
    syncVideo(v, layer.time, playing);
    if (v.readyState < 2 || v.videoWidth === 0) return;
    if (!src.tex || src.w !== v.videoWidth || src.h !== v.videoHeight) {
      src.w = v.videoWidth;
      src.h = v.videoHeight;
      src.tex = device.createTexture({ size: [src.w, src.h], format: 'rgba8unorm', usage: texUsage });
      src.bg = makeTexBG(src.tex.createView());
    }
    try {
      device.queue.copyExternalImageToTexture({ source: v }, { texture: src.tex }, [src.w, src.h]);
    } catch { /* frame not ready */ }
  }

  function render(layers: Layer[], playing: boolean) {
    const n = Math.min(layers.length, MAX_LAYERS);
    const used = new Set<string>();
    const usedText = new Set<string>();

    for (let i = 0; i < n; i++) {
      const L = layers[i];
      if (L.kind === 'text') {
        ensureText(L);
        usedText.add(L.id);
      } else if (L.assetId && L.url && (L.kind === 'image' || L.kind === 'video')) {
        ensureSource(L.assetId, L.url, L.kind);
        used.add(L.assetId);
        const src = sources.get(L.assetId);
        if (src?.kind === 'video') pumpVideo(src, L, playing);
      }
      const src = L.assetId ? sources.get(L.assetId) : undefined;
      const hasTex = L.kind === 'text' ? !!textSources.get(L.id) : !!src?.bg;
      const o = (STRIDE / 4) * i;
      cpu[o + 0] = L.x;
      cpu[o + 1] = L.y;
      cpu[o + 2] = L.scale;
      cpu[o + 3] = L.opacity;
      cpu[o + 4] = L.hue;
      cpu[o + 5] = L.brightness;
      cpu[o + 6] = L.time;
      cpu[o + 7] = hasTex ? 1 : 0;
      cpu[o + 8] = L.saturation;
      cpu[o + 9] = L.contrast;
      cpu[o + 10] = L.temperature;
      cpu[o + 12] = L.aspectX;
      cpu[o + 13] = L.aspectY;
      cpu[o + 14] = ((L.rotation ?? 0) * Math.PI) / 180;
      cpu[o + 15] = Math.max(0.01, (L.projW ?? 1280) / (L.projH ?? 720));
      cpu[o + 16] = L.blur ?? 0;
      cpu[o + 17] = L.vignette ?? 0;
      cpu[o + 18] = L.grain ?? 0;
      cpu[o + 19] = L.pixelate ?? 0;
    }
    if (n > 0) device.queue.writeBuffer(uniformBuf, 0, cpu, 0, (STRIDE / 4) * n);

    // pause any videos that are no longer on screen
    for (const [aid, src] of sources) {
      if (src.kind === 'video' && !used.has(aid) && src.video && !src.video.paused) src.video.pause();
    }
    // drop text textures for clips that are no longer present
    for (const [id, t] of textSources) {
      if (!usedText.has(id)) { t.tex.destroy(); textSources.delete(id); }
    }

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: ctx!.getCurrentTexture().createView(), clearValue: { r: STAGE[0], g: STAGE[1], b: STAGE[2], a: STAGE[3] }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    for (let i = 0; i < n; i++) {
      const L = layers[i];
      const bg = L.kind === 'text'
        ? textSources.get(L.id)?.bg ?? defaultTexBG
        : (L.assetId ? sources.get(L.assetId)?.bg : undefined) ?? defaultTexBG;
      pass.setBindGroup(0, uniformBG, [i * STRIDE]);
      pass.setBindGroup(1, bg);
      pass.draw(6);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  return { backend: 'webgpu', render, dispose: () => device.destroy() };
}

// ---- Canvas2D fallback -------------------------------------------------
function hsvToRgb(h: number, s: number, v: number) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return `rgb(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0})`;
}

// approximate the WGSL grade + effects with a CSS filter string for the 2D fallback
export function cssGrade(L: Layer): string {
  const parts = [
    `brightness(${L.brightness.toFixed(3)})`,
    `saturate(${L.saturation.toFixed(3)})`,
    `contrast(${L.contrast.toFixed(3)})`,
  ];
  if (L.temperature > 0.001) parts.push(`sepia(${Math.min(0.7, L.temperature * 0.7).toFixed(3)})`);
  else if (L.temperature < -0.001) parts.push(`hue-rotate(${(L.temperature * 22).toFixed(1)}deg)`);
  if (L.blur && L.blur > 0.001) parts.push(`blur(${(L.blur * 8).toFixed(1)}px)`);
  return parts.join(' ');
}

function createCanvas2D(canvas: HTMLCanvasElement): Compositor {
  const ctx = canvas.getContext('2d')!;
  const imgs = new Map<string, HTMLImageElement>();
  const vids = new Map<string, HTMLVideoElement>();
  const texts = new Map<string, { sig: string; cv: HTMLCanvasElement }>();

  function ensureTextCanvas(L: Layer): HTMLCanvasElement {
    const w = Math.max(16, Math.round(L.projW ?? 1280));
    const h = Math.max(16, Math.round(L.projH ?? 720));
    const sig = textSig(L);
    const cur = texts.get(L.id);
    if (cur && cur.sig === sig && cur.cv.width === w && cur.cv.height === h) return cur.cv;
    const cv = cur?.cv ?? document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    paintText(cv, L);
    texts.set(L.id, { sig, cv });
    return cv;
  }

  function render(layers: Layer[], playing: boolean) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = `rgb(${(STAGE[0] * 255) | 0}, ${(STAGE[1] * 255) | 0}, ${(STAGE[2] * 255) | 0})`;
    ctx.fillRect(0, 0, w, h);
    const used = new Set<string>();

    for (const L of layers) {
      const lw = w * L.scale * L.aspectX;
      const lh = h * L.scale * L.aspectY;
      const dx = w / 2 + L.x * (w / 2) - lw / 2;
      const dy = h / 2 - L.y * (h / 2) - lh / 2;
      ctx.globalAlpha = Math.max(0, Math.min(1, L.opacity));
      ctx.filter = cssGrade(L);

      // rotate about the layer centre when it carries a rotation
      const rot = ((L.rotation ?? 0) * Math.PI) / 180;
      const spun = Math.abs(rot) > 0.0001;
      if (spun) {
        ctx.save();
        ctx.translate(dx + lw / 2, dy + lh / 2);
        ctx.rotate(rot);
        ctx.translate(-(dx + lw / 2), -(dy + lh / 2));
      }

      if (L.kind === 'text') {
        const cv = ensureTextCanvas(L);
        ctx.drawImage(cv, dx, dy, lw, lh);
      } else if (L.kind === 'video' && L.assetId && L.url) {
        used.add(L.assetId);
        let v = vids.get(L.assetId);
        if (!v) { v = makeVideo(L.url); vids.set(L.assetId, v); }
        syncVideo(v, L.time, playing);
        if (v.readyState >= 2 && v.videoWidth > 0) ctx.drawImage(v, dx, dy, lw, lh);
        else paintSwatch(ctx, L, dx, dy, lw, lh);
      } else if (L.kind === 'image' && L.assetId && L.url) {
        let img = imgs.get(L.assetId);
        if (!img) { img = new Image(); img.crossOrigin = 'anonymous'; img.src = L.url; imgs.set(L.assetId, img); }
        if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, dx, dy, lw, lh);
        else paintSwatch(ctx, L, dx, dy, lw, lh);
      } else {
        paintSwatch(ctx, L, dx, dy, lw, lh);
      }
      if (spun) ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    for (const [aid, v] of vids) if (!used.has(aid) && !v.paused) v.pause();
  }

  async function seekAll(layers: Layer[]): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const L of layers) {
      if (L.kind !== 'video' || !L.assetId || !L.url) continue;
      let v = vids.get(L.assetId);
      if (!v) { v = makeVideo(L.url); vids.set(L.assetId, v); }
      const target = L.time;
      const vid = v;

      const doSeek = (resolve: () => void) => {
        if (Math.abs(vid.currentTime - target) < 0.001) { resolve(); return; }
        const onSeeked = () => { vid.removeEventListener('seeked', onSeeked); resolve(); };
        vid.addEventListener('seeked', onSeeked);
        vid.currentTime = target;
      };

      if (vid.readyState < 1) {
        waits.push(new Promise<void>(res => {
          const onMeta = () => { vid.removeEventListener('loadedmetadata', onMeta); doSeek(res); };
          vid.addEventListener('loadedmetadata', onMeta);
        }));
      } else {
        waits.push(new Promise<void>(res => doSeek(res)));
      }
    }
    if (waits.length) await Promise.all(waits);
  }

  function paintSwatch(c: CanvasRenderingContext2D, L: Layer, dx: number, dy: number, lw: number, lh: number) {
    const g = c.createLinearGradient(dx, dy, dx, dy + lh);
    g.addColorStop(0, hsvToRgb(L.hue, 0.5, 0.6 * L.brightness));
    g.addColorStop(1, hsvToRgb(L.hue, 0.5, 0.92 * L.brightness));
    c.fillStyle = g;
    c.fillRect(dx, dy, lw, lh);
  }

  return { backend: 'canvas2d', render, seekAll, dispose: () => {} };
}

/** Create a full-resolution Canvas2D compositor for offline export. */
export function createCanvas2DCompositor(canvas: HTMLCanvasElement): Compositor {
  return createCanvas2D(canvas);
}
